from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "nvidia/nemotron-3-super-120b-a12b:free"
    openrouter_temperature: float = 0.7
    openrouter_timeout_seconds: float = 35.0
    openrouter_http_referer: str = "http://localhost:8000"
    openrouter_app_title: str = "Scalable RAG Interview Chatbot"
    openrouter_tts_model: str = "openai/gpt-audio-mini"
    openrouter_tts_voice: str = "alloy"
    openrouter_tts_speed: float = 1.0
    # Used for gpt-audio-* (chat + modalities), not for dedicated *-tts-* speech API models.
    openrouter_tts_audio_format: str = "mp3"
    openrouter_tts_chat_temperature: float = 0.2

    llm_provider: Literal["groq", "openrouter"] = "groq"
    groq_llm_model: str = "qwen/qwen3.8-27b"

    tts_provider: Literal["groq", "openrouter"] = "groq"
    groq_api_key: str | None = None
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_tts_model: str = "canopylabs/orpheus-v1-english"
    groq_tts_voice: str = "austin"
    groq_tts_max_input_chars: int = 200
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
        extra="ignore",
    )

    @model_validator(mode="after")
    def require_keys(self) -> "Settings":
        if self.tts_provider == "groq" and not (self.groq_api_key or "").strip():
            raise ValueError(
                "GROQ_API_KEY is required when TTS_PROVIDER=groq. "
                "Set it in .env or use TTS_PROVIDER=openrouter."
            )
        has_openrouter = bool((self.openrouter_api_key or "").strip())
        has_groq = bool((self.groq_api_key or "").strip())
        if not has_openrouter and not has_groq:
            raise ValueError("Either OPENROUTER_API_KEY or GROQ_API_KEY must be set in .env.")
        return self

    @property
    def default_tts_voice(self) -> str:
        if self.tts_provider == "groq":
            return self.groq_tts_voice
        return self.openrouter_tts_voice

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
