from contextlib import contextmanager
from typing import Any
from uuid import UUID

import psycopg2
from pgvector.psycopg2 import register_vector
from psycopg2.extras import Json, RealDictCursor

from app.config import Settings


SCHEMA_SQL = """
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
"""


class Database:
    def __init__(self, settings: Settings) -> None:
        self._dsn = settings.postgres_dsn

    @contextmanager
    def connection(self):
        conn = psycopg2.connect(self._dsn)
        register_vector(conn)
        try:
            yield conn
        finally:
            conn.close()

    def initialize(self) -> None:
        with self.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(SCHEMA_SQL)
                conn.commit()

    def clear_session(self, session_id: UUID) -> None:
        with self.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM cv_chunks WHERE session_id = %s", (str(session_id),))
                conn.commit()

    def insert_chunks(
        self,
        session_id: UUID,
        role_name: str,
        source_filename: str,
        chunks: list[str],
        embeddings: list[list[float]],
        metadata: dict[str, Any] | None = None,
    ) -> None:
        payload = metadata or {}
        with self.connection() as conn:
            with conn.cursor() as cur:
                for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True)):
                    cur.execute(
                        """
                        INSERT INTO cv_chunks (
                            session_id,
                            role_name,
                            source_filename,
                            chunk_index,
                            chunk_text,
                            metadata,
                            embedding
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            str(session_id),
                            role_name,
                            source_filename,
                            index,
                            chunk,
                            Json(payload),
                            embedding,
                        ),
                    )
                conn.commit()

    def similarity_search(
        self,
        session_id: UUID,
        query_embedding: list[float],
        top_k: int,
    ) -> list[dict[str, Any]]:
        with self.connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT
                        chunk_text,
                        role_name,
                        source_filename,
                        metadata,
                        1 - (embedding <=> %s::vector) AS similarity
                    FROM cv_chunks
                    WHERE session_id = %s
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (query_embedding, str(session_id), query_embedding, top_k),
                )
                return [dict(row) for row in cur.fetchall()]
