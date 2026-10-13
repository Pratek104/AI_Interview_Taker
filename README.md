# Scalable RAG Interview Chatbot

An AI-powered interview application that uses a candidate's CV to generate grounded interview questions and conduct a voice-enabled interview. The backend is built with FastAPI and PostgreSQL/pgvector; the frontend is a React application powered by Vite.

## How it works

1. A candidate selects a target role and uploads a PDF CV.
2. The backend extracts CV text with OCR, splits it into chunks, generates `all-MiniLM-L6-v2` embeddings, and stores the chunks in PostgreSQL with pgvector.
3. OpenRouter generates the CV summary, introduction, interview questions, and final score using the retrieved CV context.
4. The React interview room presents the conversation and can request spoken interviewer responses.
5. The proctoring endpoint can detect a phone in an uploaded image using YOLO.

## Features

- OCR extraction for searchable and scanned/image-based PDFs
- Retrieval-augmented interview questions grounded in the uploaded CV
- Role-specific interview sessions with introduction, Q&A, and final scoring phases
- PostgreSQL vector storage with the `pgvector` extension
- React setup pages and voice-orb interview interface
- Configurable speech generation through Groq or OpenRouter
- Optional phone detection for interview proctoring
- Docker Compose setup for a local pgvector database
- FastAPI serving of the built React application

## Prerequisites

- Python 3.11 or newer
- Node.js 18 or newer and npm
- Docker Desktop
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
- Poppler, required by `pdf2image`
- An OpenRouter API key
- A Groq API key when `TTS_PROVIDER=groq` (the default)

On Windows, set `TESSERACT_CMD` to the path of `tesseract.exe`. Set `POPPLER_PATH` when Poppler is not available on `PATH`.

## Configuration

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

At minimum, set:

```dotenv
OPENROUTER_API_KEY=your-openrouter-key
GROQ_API_KEY=your-groq-key
```

The defaults in `.env.example` configure:

- OpenRouter as the LLM provider
- Groq Orpheus as the speech provider
- PostgreSQL on `localhost:15432`
- `all-MiniLM-L6-v2` embeddings
- `http://localhost:5173` as the frontend origin

Set `TTS_PROVIDER=openrouter` to use the OpenRouter audio model instead of Groq. `DEFAULT_AVATAR_URL` can point to a Ready Player Me `.glb` asset if an avatar URL is needed by the frontend.

## Local development

### 1. Start PostgreSQL with pgvector

```powershell
docker compose up -d
```

The database is exposed on host port `15432`. The first startup runs [`schema.sql`](./schema.sql), which creates the `vector` extension and `cv_chunks` table.

### 2. Create the Python environment

```powershell
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

### 3. Start the FastAPI backend

From the repository root:

```powershell
uvicorn app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`. Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

### 4. Start the React frontend

In a second terminal:

```powershell
cd frontend\react_frontend
npm install
npm run dev
```

The Vite development server runs at `http://localhost:5173` and proxies API requests to FastAPI.

## Production-style frontend serving

Build the frontend:

```powershell
cd frontend\react_frontend
npm run build
```

Then start FastAPI from the repository root:

```powershell
uvicorn app.main:app
```

When `frontend/react_frontend/dist` exists, FastAPI serves the built React application and its routes.

## API

### `GET /health`

Returns the service health status:

```json
{
  "status": "ok"
}
```
### `POST /upload`

Uploads a PDF CV and starts an interview session.

Multipart form fields:

- `role_name`: target role, at least two characters
- `file`: PDF CV

The response includes `session_id`, CV metadata, the generated summary, and the opening interview message.

### `POST /chat`

Sends a candidate response and returns the next grounded interviewer response.

```json
{
  "session_id": "uuid-from-upload",
  "message": "Candidate reply text"
}
```

The response includes the current interview phase and the CV chunks retrieved for grounding.

### `POST /generate-speech`

Generates interviewer audio and timing metadata:

```json
{
  "text": "Welcome to the interview.",
  "phase": "introduction",
  "voice": "en-US-GuyNeural"
}
```

### `POST /proctoring/detect-phone`

Uploads an image as the `image` multipart field and returns whether a phone was detected, along with the confidence and detected label.

### `GET /frontend-config`

Returns frontend defaults such as the configured avatar URL and TTS voice.

## Testing and frontend checks

Run the Python tests:

```powershell
python -m pytest
```

Run the frontend lint and production build:

```powershell
cd frontend\react_frontend
npm run lint
npm run build
```

## Project structure

```text
app/                         FastAPI application and interview services
  db.py                      PostgreSQL/pgvector persistence
  interview.py               Session state and interview prompts
  llm.py                     OpenRouter client
  ocr.py                     PDF text extraction and OCR
  proctoring.py              YOLO phone detection
  rag.py                     Chunking and embeddings
  speech.py                  Groq/OpenRouter speech generation
frontend/react_frontend/     React/Vite client
schema.sql                   PostgreSQL and pgvector schema
docker-compose.yml           Local PostgreSQL/pgvector service
requirements.txt             Python dependencies
```

## Notes and limitations

- Interview sessions are stored in process memory. Use Redis or PostgreSQL-backed session state for multi-instance deployments.
- The embedding model produces 384-dimensional vectors, matching the database schema.
- A fresh database volume runs `schema.sql` automatically. Existing volumes do not automatically rerun initialization scripts.
- API error responses include the underlying pipeline failure message during development; review this before exposing the service publicly.
