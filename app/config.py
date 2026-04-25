from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openrouter_api_key: str
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "nvidia/nemotron-3-super-120b-a12b:free"
    openrouter_temperature: float = 0.7
    openrouter_http_referer: str = "http://localhost:8000"
    openrouter_app_title: str = "Scalable RAG Interview Chatbot"
    edge_tts_voice: str = "en-US-AvaMultilingualNeural"
    edge_tts_rate: str = "+0%"
    edge_tts_pitch: str = "+0Hz"
    default_avatar_url: str = ""
    frontend_origin: str = "http://localhost:5173"

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "interview_bot"
    postgres_user: str = "interview_user"
    postgres_password: str = "interview_pass"

    tesseract_cmd: str = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    poppler_path: str | None = None
    embedding_model: str = "all-MiniLM-L6-v2"
    chunk_size: int = 700
    chunk_overlap: int = 120
    top_k: int = 4

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    @property
    def postgres_dsn(self) -> str:
        return (
            f"host={self.postgres_host} "
            f"port={self.postgres_port} "
            f"dbname={self.postgres_db} "
            f"user={self.postgres_user} "
            f"password={self.postgres_password}"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
