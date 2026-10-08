import logging
from contextlib import contextmanager
from typing import Any
from uuid import UUID

import numpy as np
import psycopg2
from pgvector.psycopg2 import register_vector
from psycopg2.extras import Json, RealDictCursor

from app.config import Settings

logger = logging.getLogger(__name__)

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
"""


class Database:
    def __init__(self, settings: Settings) -> None:
        self._dsn = settings.postgres_dsn
        self._use_fallback = False
        self._in_memory_store: dict[str, list[dict[str, Any]]] = {}

    @contextmanager
    def connection(self):
        conn = psycopg2.connect(self._dsn, connect_timeout=3)
        register_vector(conn)
        try:
            yield conn
        finally:
            conn.close()

    def initialize(self) -> None:
        try:
            with self.connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(SCHEMA_SQL)
                    conn.commit()
            logger.info("Successfully connected to PostgreSQL database.")
        except Exception as exc:
            logger.warning(
                f"PostgreSQL connection failed ({exc}). Falling back to in-memory vector storage."
            )
            self._use_fallback = True

    def clear_session(self, session_id: UUID) -> None:
        if self._use_fallback:
            self._in_memory_store.pop(str(session_id), None)
            return
        try:
            with self.connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM cv_chunks WHERE session_id = %s", (str(session_id),))
                    conn.commit()
        except Exception:
            self._in_memory_store.pop(str(session_id), None)

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
        if self._use_fallback:
            items = []
            for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True)):
                items.append({
                    "chunk_text": chunk,
                    "role_name": role_name,
                    "source_filename": source_filename,
                    "chunk_index": index,
                    "metadata": payload,
                    "embedding": embedding,
                })
            self._in_memory_store[str(session_id)] = items
            return

        try:
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
        except Exception as exc:
            logger.warning(f"PostgreSQL insert failed ({exc}); saving in memory store.")
            items = []
            for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True)):
                items.append({
                    "chunk_text": chunk,
                    "role_name": role_name,
                    "source_filename": source_filename,
                    "chunk_index": index,
                    "metadata": payload,
                    "embedding": embedding,
                })
            self._in_memory_store[str(session_id)] = items

    def similarity_search(
        self,
        session_id: UUID,
        query_embedding: list[float],
        top_k: int,
    ) -> list[dict[str, Any]]:
        if self._use_fallback or str(session_id) in self._in_memory_store:
            items = self._in_memory_store.get(str(session_id), [])
            if not items:
                return []
            q_vec = np.array(query_embedding, dtype=np.float32)
            q_norm = np.linalg.norm(q_vec)
            if q_norm == 0:
                q_norm = 1.0

            scored = []
            for item in items:
                e_vec = np.array(item["embedding"], dtype=np.float32)
                e_norm = np.linalg.norm(e_vec)
                if e_norm == 0:
                    e_norm = 1.0
                similarity = float(np.dot(q_vec, e_vec) / (q_norm * e_norm))
                scored.append({
                    "chunk_text": item["chunk_text"],
                    "role_name": item["role_name"],
                    "source_filename": item["source_filename"],
                    "metadata": item["metadata"],
                    "similarity": similarity,
                })

            scored.sort(key=lambda x: x["similarity"], reverse=True)
            return scored[:top_k]

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
