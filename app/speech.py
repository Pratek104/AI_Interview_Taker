import base64

import edge_tts

from app.config import Settings
from app.models import InterviewPhase, SpeechResponse, SpeechWordBoundary

TICKS_PER_MILLISECOND = 10_000


class SpeechService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def synthesize(
        self,
        text: str,
        phase: InterviewPhase,
        voice: str | None = None,
    ) -> SpeechResponse:
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice or self._settings.edge_tts_voice,
            rate=self._settings.edge_tts_rate,
            pitch=self._settings.edge_tts_pitch,
            boundary="WordBoundary",
        )

        audio_chunks: list[bytes] = []
        word_boundaries: list[SpeechWordBoundary] = []

        async for chunk in communicate.stream():
            chunk_type = chunk["type"]
            if chunk_type == "audio":
                audio_chunks.append(chunk["data"])
            elif chunk_type == "WordBoundary":
                word_boundaries.append(
                    SpeechWordBoundary(
                        text=chunk["text"],
                        offset_ms=int(chunk["offset"] / TICKS_PER_MILLISECOND),
                        duration_ms=max(1, int(chunk["duration"] / TICKS_PER_MILLISECOND)),
                    )
                )

        audio_bytes = b"".join(audio_chunks)
        if not audio_bytes:
            raise ValueError("No speech audio was generated.")

        return SpeechResponse(
            audio_base64=base64.b64encode(audio_bytes).decode("utf-8"),
            voice=voice or self._settings.edge_tts_voice,
            phase=phase,
            word_boundaries=word_boundaries,
        )
