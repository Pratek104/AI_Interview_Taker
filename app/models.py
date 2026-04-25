from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class InterviewPhase(str, Enum):
    INTRODUCTION = "introduction"
    QNA = "qna"


class UploadResponse(BaseModel):
    session_id: UUID
    role_name: str
    filename: str
    extracted_characters: int
    chunk_count: int
    cv_summary: str
    current_phase: InterviewPhase
    opening_message: str


class ChatRequest(BaseModel):
    session_id: UUID
    message: str = Field(min_length=1)


class ChatResponse(BaseModel):
    session_id: UUID
    phase: InterviewPhase
    answer: str
    retrieved_context: list[dict[str, Any]]


class ChatTurn(BaseModel):
    role: str
    content: str


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1)
    phase: InterviewPhase = InterviewPhase.QNA
    voice: str | None = None


class SpeechWordBoundary(BaseModel):
    text: str
    offset_ms: int
    duration_ms: int


class SpeechResponse(BaseModel):
    audio_base64: str
    mime_type: str = "audio/mpeg"
    voice: str
    phase: InterviewPhase
    word_boundaries: list[SpeechWordBoundary]


class FrontendConfigResponse(BaseModel):
    default_avatar_url: str
    default_voice: str


class ProctoringDetectionResponse(BaseModel):
    phone_detected: bool
    confidence: float
    label: str
