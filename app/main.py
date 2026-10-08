from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.db import Database
from app.interview import FINAL_SCORE_PROMPT, INTRO_PROMPT, QNA_PROMPT, InterviewManager
from app.llm import OpenRouterClient
from app.models import (
    ChatRequest,
    ChatResponse,
    FrontendConfigResponse,
    InterviewPhase,
    ProctoringDetectionResponse,
    SpeechRequest,
    SpeechResponse,
    UploadResponse,
)
from app.ocr import configure_tesseract, extract_text_from_pdf, validate_pdf_filename
from app.proctoring import YoloProctoringService
from app.rag import RagPipeline
from app.speech import SpeechService


settings = get_settings()
database = Database(settings)
rag_pipeline = RagPipeline(settings)
interview_manager = InterviewManager()
llm_client = OpenRouterClient(settings)
speech_service = SpeechService(settings)
proctoring_service = YoloProctoringService()
MODEL_DIR = Path(__file__).resolve().parent.parent / "3dmodel"
REACT_DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "react_frontend" / "dist"
REACT_ASSETS_DIR = REACT_DIST_DIR / "assets"


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_tesseract(settings.tesseract_cmd)
    database.initialize()
    yield


app = FastAPI(
    title="Scalable RAG Interview Chatbot",
    version="0.1.0",
    lifespan=lifespan,
)
if MODEL_DIR.exists():
    app.mount("/3dmodel", StaticFiles(directory=MODEL_DIR), name="3dmodel")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
if REACT_ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=REACT_ASSETS_DIR), name="react-assets")


def build_summary(text: str) -> str:
    trimmed = text[:3500]
    return llm_client.chat(
        system_prompt=(
            "You summarize CVs for recruiters. Extract the strongest skills, companies, projects, "
            "and achievements in a short factual paragraph."
        ),
        messages=[{"role": "user", "content": trimmed}],
    )


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/frontend-config", response_model=FrontendConfigResponse)
def frontend_config() -> FrontendConfigResponse:
    return FrontendConfigResponse(
        default_avatar_url=settings.default_avatar_url,
        default_voice=settings.default_tts_voice,
    )


@app.get("/", include_in_schema=False)
def index():
    if REACT_DIST_DIR.exists():
        return FileResponse(REACT_DIST_DIR / "index.html")
    return JSONResponse(
        {
            "message": "API is running. Start the React frontend from frontend/react_frontend with npm run dev.",
            "frontend_origin": settings.frontend_origin,
        }
    )


@app.post("/upload", response_model=UploadResponse)
async def upload_cv(
    role_name: str = Form(..., min_length=2),
    file: UploadFile = File(...),
) -> UploadResponse:
    try:
        filename = validate_pdf_filename(file.filename or "uploaded_cv.pdf")
        pdf_bytes = await file.read()
        extracted_text = extract_text_from_pdf(pdf_bytes, settings.poppler_path)
        chunks = rag_pipeline.chunk_text(extracted_text)
        embeddings = rag_pipeline.embed_texts(chunks)
        session_id = uuid4()
        database.clear_session(session_id)
        database.insert_chunks(
            session_id=session_id,
            role_name=role_name,
            source_filename=filename,
            chunks=chunks,
            embeddings=embeddings,
            metadata={"character_count": len(extracted_text)},
        )
        cv_summary = build_summary(extracted_text)
        interview_manager.start_session(session_id, role_name, cv_summary)
        opening_message = llm_client.chat(
            system_prompt=INTRO_PROMPT,
            messages=interview_manager.build_intro_messages(session_id),
        )
        interview_manager.append_turn(session_id, "assistant", opening_message)
        return UploadResponse(
            session_id=session_id,
            role_name=role_name,
            filename=filename,
            extracted_characters=len(extracted_text),
            chunk_count=len(chunks),
            cv_summary=cv_summary,
            current_phase=InterviewPhase.INTRODUCTION,
            opening_message=opening_message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload pipeline failed: {exc}") from exc


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    try:
        state = interview_manager.get_session(request.session_id)
        if state.phase == InterviewPhase.INTRODUCTION:
            interview_manager.complete_introduction(request.session_id)
            state = interview_manager.get_session(request.session_id)

        query_embedding = rag_pipeline.embed_query(request.message)
        retrieved_context = database.similarity_search(
            session_id=request.session_id,
            query_embedding=query_embedding,
            top_k=settings.top_k,
        )
        if not retrieved_context:
            raise HTTPException(status_code=404, detail="No CV context found for this session.")

        answered_before_current = interview_manager.candidate_answer_count(request.session_id)
        target_total = interview_manager.get_session(request.session_id).max_questions
        should_finalize = (answered_before_current + 1) >= target_total
        if should_finalize:
            answer = llm_client.chat(
                system_prompt=FINAL_SCORE_PROMPT,
                messages=interview_manager.build_final_score_messages(
                    request.session_id,
                    candidate_message=request.message,
                    retrieved_context=retrieved_context,
                ),
            )
        else:
            answer = llm_client.chat(
                system_prompt=QNA_PROMPT if state.phase == InterviewPhase.QNA else INTRO_PROMPT,
                messages=interview_manager.build_qna_messages(
                    request.session_id,
                    candidate_message=request.message,
                    retrieved_context=retrieved_context,
                ),
            )
        interview_manager.append_turn(request.session_id, "user", request.message)
        interview_manager.append_turn(request.session_id, "assistant", answer)

        return ChatResponse(
            session_id=request.session_id,
            phase=state.phase,
            answer=answer,
            retrieved_context=retrieved_context,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chat failed: {exc}") from exc


@app.post("/generate-speech", response_model=SpeechResponse)
async def generate_speech(request: SpeechRequest) -> SpeechResponse:
    try:
        return await speech_service.synthesize(
            text=request.text,
            phase=request.phase,
            voice=request.voice,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Speech generation failed: {exc}") from exc


@app.post("/proctoring/detect-phone", response_model=ProctoringDetectionResponse)
async def detect_phone(image: UploadFile = File(...)) -> ProctoringDetectionResponse:
    try:
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Image payload is empty.")
        result = proctoring_service.detect_phone(image_bytes)
        return ProctoringDetectionResponse(
            phone_detected=result.phone_detected,
            confidence=result.confidence,
            label=result.label,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Phone detection failed: {exc}") from exc


@app.get("/{frontend_path:path}", include_in_schema=False)
def react_frontend_fallback(frontend_path: str):
    if REACT_DIST_DIR.exists():
        return FileResponse(REACT_DIST_DIR / "index.html")
    return JSONResponse(
        {
            "message": "Frontend route not found because the React app has not been built yet.",
            "requested_path": frontend_path,
        },
        status_code=404,
    )
