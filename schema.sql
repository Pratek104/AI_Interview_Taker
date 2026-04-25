CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS cv_chunks (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL,
    role_name TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(384) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cv_chunks_session_id
    ON cv_chunks (session_id);

CREATE INDEX IF NOT EXISTS idx_cv_chunks_embedding
    ON cv_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
