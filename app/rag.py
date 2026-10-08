from sentence_transformers import SentenceTransformer

try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except ImportError:
    class RecursiveCharacterTextSplitter:  # type: ignore[no-redef]
        def __init__(self, chunk_size: int = 700, chunk_overlap: int = 120):
            self.chunk_size = chunk_size
            self.chunk_overlap = chunk_overlap

        def split_text(self, text: str) -> list[str]:
            if not text:
                return []
            chunks = []
            start = 0
            while start < len(text):
                end = start + self.chunk_size
                chunk = text[start:end]
                chunks.append(chunk)
                start += self.chunk_size - self.chunk_overlap
            return chunks

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
