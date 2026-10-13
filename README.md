# AI Interview Taker

AI Interview Taker is a CV-aware interview platform for practicing or conducting structured technical interviews. Candidates upload a PDF CV, choose a target role, and complete a conversational interview whose questions are grounded in the candidate's own experience.

The project combines:

- **FastAPI** for the backend API
- **React and Vite** for the interview interface
- **PostgreSQL and pgvector** for CV embeddings and retrieval
- **OpenRouter or Groq** for language-model responses
- **Groq or OpenRouter audio models** for interviewer speech
- **Tesseract and Poppler** for PDF text extraction and OCR
- **YOLO** for optional phone-detection proctoring

## Interview flow

1. The candidate selects a target role and uploads a PDF CV.
2. The backend extracts text, including from scanned PDFs, and splits it into chunks.
3. The chunks are embedded with `all-MiniLM-L6-v2` and stored in PostgreSQL.
4. The LLM summarizes the CV and generates an introduction and role-specific questions.
5. Each candidate response retrieves relevant CV chunks before the next response is generated.
6. The final interview response includes an AI-generated score and evaluation.

## Features

- CV upload and OCR for searchable or scanned PDFs
- Retrieval-augmented, CV-grounded interview questions
- Introduction, Q&A, and final scoring phases
- Voice-enabled interviewer responses with timing metadata
- React setup screens and voice-orb interview room
- Optional YOLO phone detection through the proctoring API
- Local PostgreSQL/pgvector environment through Docker Compose
- Built React frontend served directly by FastAPI

## Prerequisites

- Python 3.11+
- Node.js 18+ and npm
- Docker Desktop
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
- Poppler for `pdf2image`
- An OpenRouter API key
- A Groq API key when using the default Groq speech provider

On Windows, install Tesseract and set `TESSERACT_CMD` to the full path of `tesseract.exe`. Set `POPPLER_PATH` if Poppler is not available on `PATH`.

## Quick start

### 1. Configure environment variables

From the repository root:

```powershell
Copy-Item .env.example .env
```

Set the provider keys in `.env`:

```dotenv
OPENROUTER_API_KEY=your-openrouter-api-key
GROQ_API_KEY=your-groq-api-key
```

The sample configuration uses:

- PostgreSQL at `localhost:15432`
- OpenRouter for the default LLM
- Groq for speech generation
- `all-MiniLM-L6-v2` for 384-dimensional embeddings
- `http://localhost:5173` as the frontend origin

To use OpenRouter audio instead of Groq speech, set:

```dotenv
TTS_PROVIDER=openrouter
```

### 2. Start PostgreSQL and pgvector

```powershell
docker compose up -d
```

The database is available on host port `15432`. On a new database volume, Docker runs [`schema.sql`](./schema.sql) automatically and creates the `vector` extension and `cv_chunks` table.

### 3. Install backend dependencies

```powershell
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

### 4. Start the API

From the repository root:

```powershell
uvicorn app.main:app --reload
```

The backend runs at `http://127.0.0.1:8000`.

- Swagger UI: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/health`

### 5. Start the frontend

Open a second terminal:

```powershell
cd frontend\react_frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`. Vite proxies API requests to the FastAPI server.

## Production-style local run

Build the React application:

```powershell
cd frontend\react_frontend
npm run build
```

Then start FastAPI from the repository root:

```powershell
uvicorn app.main:app
```

When `frontend/react_frontend/dist` exists, FastAPI serves the compiled React application and its routes.

## API reference

### `GET /health`

Returns:

```json
{
  "status": "ok"
}
```

### `POST /upload`

Starts an interview session from a PDF CV.

Multipart form fields:

- `role_name`: target role, at least two characters
- `file`: PDF CV

The response includes the generated `session_id`, extracted character and chunk counts, CV summary, interview phase, and opening message.

### `POST /chat`

Submits a candidate response:

```json
{
  "session_id": "uuid-from-upload",
  "message": "Candidate reply text"
}
```

The response contains the next interviewer answer, current phase, and the CV context retrieved for grounding.

### `POST /generate-speech`

Generates interviewer audio and word-boundary timing metadata:

```json
{
  "text": "Welcome to the interview.",
  "phase": "introduction",
  "voice": "en-US-GuyNeural"
}
```

### `POST /proctoring/detect-phone`

Uploads an image using the `image` multipart field. The response reports whether a phone was detected, its confidence, and the detected label.

### `GET /frontend-config`

Returns frontend defaults including the configured avatar URL and default voice.

## Testing and checks

Run the backend tests:

```powershell
python -m pytest
```

Run frontend linting and a production build:

```powershell
cd frontend\react_frontend
npm run lint
npm run build
```

## Repository layout

```text
app/
  config.py       Settings and environment validation
  db.py           PostgreSQL and pgvector access
  interview.py    Interview state and prompt construction
  llm.py          LLM provider clients
  ocr.py          PDF extraction and OCR
  proctoring.py   YOLO phone detection
  rag.py          Text chunking and embeddings
  speech.py       Speech provider integration

frontend/react_frontend/  React/Vite client
schema.sql                PostgreSQL and pgvector schema
docker-compose.yml        Local PostgreSQL service
requirements.txt          Python dependencies
.env.example              Environment variable template
```

## Known limitations

- Interview state is stored in process memory and is not shared across backend instances.
- Use Redis or PostgreSQL-backed session storage for a multi-instance deployment.
- Existing Docker database volumes do not rerun initialization scripts automatically.
- API error messages expose pipeline details intended for development; review error handling before public deployment.
