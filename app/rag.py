from sentence_transformers import SentenceTransformer

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import Settings


class RagPipeline:
    def __init__(self, settings: Settings) -> None:
        self._embedder = SentenceTransformer(settings.embedding_model)
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )

    def chunk_text(self, text: str) -> list[str]:
        chunks = [chunk.strip() for chunk in self._splitter.split_text(text) if chunk.strip()]
        if not chunks:
            raise ValueError("No extractable text was found in the uploaded PDF.")
        return chunks

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        vectors = self._embedder.encode(texts, normalize_embeddings=True)
        return vectors.tolist()

    def embed_query(self, text: str) -> list[float]:
        vector = self._embedder.encode(text, normalize_embeddings=True)
        return vector.tolist()
