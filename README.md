# Scalable RAG Interview Chatbot

This project is a FastAPI-based MVP for a CV-driven interview chatbot. It uses OCR to extract text from uploaded PDF CVs, chunks and embeds that content with `all-MiniLM-L6-v2`, stores the vectors in PostgreSQL with `pgvector`, generates structured interview turns through OpenRouter using `nvidia/nemotron-3-super-120b-a12b:free`, and now ships with a React frontend that guides the user through CV upload, role selection, interview mode selection, and the live interview room.

## Features

- OCR pipeline for non-searchable PDFs using `pdf2image` and `pytesseract`
- RAG storage in PostgreSQL with the `pgvector` extension
- Session-oriented interview state machine with introduction and CV-grounded Q&A
- FastAPI endpoints for CV upload and chat
- `edge-tts` speech synthesis endpoint with word-boundary timing metadata
- React frontend in `frontend/react_frontend` with routed setup pages and a voice orb interview UI
- Docker Compose setup for a local pgvector database

## Setup

1. Install Tesseract OCR and Poppler on the host machine.
2. Copy `.env.example` to `.env` and fill in your OpenRouter key.
3. Optionally set `DEFAULT_AVATAR_URL` to a Ready Player Me `.glb` URL so the frontend starts with a prefilled avatar.
4. Start PostgreSQL:

```powershell
docker compose up -d
```

The compose file maps the container database port to host port `15432` to avoid conflicts with any local PostgreSQL service already using common Postgres ports.

5. Install Python dependencies:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

6. Run the API:

```powershell
uvicorn app.main:app --reload

7. Run the React frontend in development:

```powershell
cd frontend\react_frontend
npm install
npm run dev
```

The Vite dev server proxies API calls to FastAPI on `http://127.0.0.1:8000`.
```

## API

### `POST /upload`

Multipart form fields:

- `role_name`: target role the candidate is applying for
- `file`: PDF CV file

Returns a generated `session_id`, CV summary, extracted metadata, and the opening interview message.

### `POST /chat`

JSON body:

```json
{
  "session_id": "uuid-from-upload",
  "message": "Candidate reply text"
}
```

Returns the next recruiter question plus the retrieved CV chunks used to ground it.

### `POST /generate-speech`

JSON body:

```json
{
  "text": "Welcome to the interview.",
  "phase": "introduction",
  "voice": "en-US-GuyNeural"
}
```

Returns Base64-encoded MP3 audio plus Edge-TTS word-boundary metadata that the React frontend can use for spoken interviewer playback.

## Notes

- The current session memory is in-process, which is acceptable for an MVP but should move to Redis or Postgres for multi-instance deployments.
- `all-MiniLM-L6-v2` produces 384-dimensional vectors, which matches the schema.
- The upload flow always runs OCR so scanned and image-based PDFs are handled consistently.
- The React frontend supports a voice-orb interface instead of the previous 3D avatar flow.
- After running `npm run build` in `frontend/react_frontend`, FastAPI can serve the built frontend bundle directly.
