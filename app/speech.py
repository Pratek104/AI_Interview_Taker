import asyncio
import base64
import io
import wave

from openai import OpenAI

from app.config import Settings
from app.models import InterviewPhase, SpeechResponse

_AUDIO_FORMAT_MIME = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "opus": "audio/opus",
    "flac": "audio/flac",
    "aac": "audio/aac",
}

_ORPHEUS_ENGLISH_VOICES = frozenset(
    {"autumn", "diana", "hannah", "austin", "daniel", "troy"}
)


def _chunk_text_max_chars(text: str, max_chars: int) -> list[str]:
    """Split for APIs with a hard per-request character limit (e.g. Groq Orpheus 200)."""
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    if len(cleaned) <= max_chars:
        return [cleaned]
    chunks: list[str] = []
    rest = cleaned
    while rest:
        if len(rest) <= max_chars:
            chunks.append(rest)
            break
        window = rest[:max_chars]
        cut = window.rfind(" ")
        if cut >= max_chars // 2:
            chunks.append(rest[:cut].strip())
            rest = rest[cut:].lstrip()
        else:
            chunks.append(rest[:max_chars].strip())
            rest = rest[max_chars:].lstrip()
    return [c for c in chunks if c]


def _merge_wav_bytes(segments: list[bytes]) -> bytes:
    if not segments:
        return b""
    if len(segments) == 1:
        return segments[0]

    buf0 = io.BytesIO(segments[0])
    with wave.open(buf0, "rb") as w0:
        params = w0.getparams()
        frame_parts: list[bytes] = [w0.readframes(w0.getnframes())]

    key = (params.nchannels, params.sampwidth, params.framerate, params.comptype, params.compname)

    for seg in segments[1:]:
        with wave.open(io.BytesIO(seg), "rb") as w:
            p = w.getparams()
            pkey = (p.nchannels, p.sampwidth, p.framerate, p.comptype, p.compname)
            if pkey != key:
                raise ValueError("TTS returned WAV segments with mismatched format; cannot merge.")
            frame_parts.append(w.readframes(w.getnframes()))

    out = io.BytesIO()
    with wave.open(out, "wb") as wo:
        wo.setnchannels(params.nchannels)
        wo.setsampwidth(params.sampwidth)
        wo.setframerate(params.framerate)
        wo.setcomptype(params.comptype, params.compname)
        wo.writeframes(b"".join(frame_parts))
    return out.getvalue()


class SpeechService:
    """
    TTS backends (see TTS_PROVIDER in settings):
    - groq: Groq Orpheus via POST .../audio/speech (WAV only; input chunked to API limits).
    - openrouter: OpenRouter — dedicated *-tts-* models use /audio/speech; gpt-audio-* uses
      chat completions + modalities + streaming.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        if settings.tts_provider == "groq":
            self._client = OpenAI(
                api_key=(settings.groq_api_key or "").strip(),
                base_url=settings.groq_base_url,
            )
        else:
            self._client = OpenAI(
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
            )

    def _resolve_groq_voice(self, voice: str | None) -> str:
        default = self._settings.groq_tts_voice
        if not voice or not voice.strip():
            return default
        v = voice.strip().lower()
        if v in _ORPHEUS_ENGLISH_VOICES:
            return v
        return default

    def _resolve_openrouter_voice(self, voice: str | None) -> str:
        default = self._settings.openrouter_tts_voice
        if not voice or not voice.strip():
            return default
        v = voice.strip().lower()
        if "-" in v or "neural" in v:
            return default
        return v

    def _extra_headers_openrouter(self) -> dict[str, str]:
        return {
            "HTTP-Referer": self._settings.openrouter_http_referer,
            "X-Title": self._settings.openrouter_app_title,
        }

    @staticmethod
    def _model_uses_openrouter_speech_endpoint(model: str) -> bool:
        m = model.lower()
        if "gpt-audio" in m:
            return False
        return "tts" in m or "text-to-speech" in m

    def _synthesize_groq_orpheus(
        self,
        text: str,
        phase: InterviewPhase,
        resolved_voice: str,
    ) -> SpeechResponse:
        limit = self._settings.groq_tts_max_input_chars
        pieces = _chunk_text_max_chars(text, limit)
        if not pieces:
            raise ValueError("No text to synthesize.")

        wav_segments: list[bytes] = []
        for part in pieces:
            response = self._client.audio.speech.create(
                model=self._settings.groq_tts_model,
                input=part,
                voice=resolved_voice,
                response_format="wav",
                timeout=self._settings.openrouter_timeout_seconds,
            )
            chunk = response.content
            if not chunk:
                raise ValueError("Groq TTS returned empty audio for a segment.")
            wav_segments.append(chunk)

        audio_bytes = _merge_wav_bytes(wav_segments)
        if not audio_bytes:
            raise ValueError("No speech audio was generated.")

        return SpeechResponse(
            audio_base64=base64.b64encode(audio_bytes).decode("utf-8"),
            mime_type="audio/wav",
            voice=resolved_voice,
            phase=phase,
            word_boundaries=[],
        )

    def _synthesize_openrouter_speech_api(
        self,
        text: str,
        phase: InterviewPhase,
        resolved_voice: str,
    ) -> SpeechResponse:
        kwargs: dict = {
            "model": self._settings.openrouter_tts_model,
            "input": text,
            "voice": resolved_voice,
            "response_format": "mp3",
            "timeout": self._settings.openrouter_timeout_seconds,
            "extra_headers": self._extra_headers_openrouter(),
        }
        speed = self._settings.openrouter_tts_speed
        if speed and speed != 1.0:
            kwargs["speed"] = speed

        response = self._client.audio.speech.create(**kwargs)
        audio_bytes = response.content
        if not audio_bytes:
            raise ValueError("No speech audio was generated.")

        return SpeechResponse(
            audio_base64=base64.b64encode(audio_bytes).decode("utf-8"),
            mime_type="audio/mpeg",
            voice=resolved_voice,
            phase=phase,
            word_boundaries=[],
        )

    def _delta_audio_data(self, delta: object) -> str | None:
        if delta is None:
            return None
        audio = getattr(delta, "audio", None)
        if audio is None:
            return None
        if isinstance(audio, dict):
            data = audio.get("data")
            return data if isinstance(data, str) else None
        data = getattr(audio, "data", None)
        return data if isinstance(data, str) else None

    def _synthesize_openrouter_chat_audio(
        self,
        text: str,
        phase: InterviewPhase,
        resolved_voice: str,
    ) -> SpeechResponse:
        fmt = self._settings.openrouter_tts_audio_format
        stream = self._client.chat.completions.create(
            model=self._settings.openrouter_tts_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are the interviewer's voice. Read the following text aloud for the "
                        "candidate. Keep the wording exactly the same; do not add, remove, or "
                        "rephrase. Speak clearly and professionally."
                    ),
                },
                {"role": "user", "content": text},
            ],
            modalities=["text", "audio"],
            audio={"voice": resolved_voice, "format": fmt},
            stream=True,
            temperature=self._settings.openrouter_tts_chat_temperature,
            max_completion_tokens=8192,
            extra_headers=self._extra_headers_openrouter(),
            timeout=self._settings.openrouter_timeout_seconds,
        )

        b64_parts: list[str] = []
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            piece = self._delta_audio_data(delta)
            if piece:
                b64_parts.append(piece)

        if not b64_parts:
            raise ValueError(
                "No speech audio was returned. For openai/gpt-audio-mini, OpenRouter expects "
                "chat completions with modalities [text, audio] and streaming — not /audio/speech."
            )

        audio_bytes = base64.b64decode("".join(b64_parts))
        if not audio_bytes:
            raise ValueError("No speech audio was generated.")

        mime = _AUDIO_FORMAT_MIME.get(fmt, "audio/mpeg")
        return SpeechResponse(
            audio_base64=base64.b64encode(audio_bytes).decode("utf-8"),
            mime_type=mime,
            voice=resolved_voice,
            phase=phase,
            word_boundaries=[],
        )

    def _synthesize_sync(
        self,
        text: str,
        phase: InterviewPhase,
        voice: str | None,
    ) -> SpeechResponse:
        if self._settings.tts_provider == "groq":
            resolved = self._resolve_groq_voice(voice)
            return self._synthesize_groq_orpheus(text, phase, resolved)

        resolved = self._resolve_openrouter_voice(voice)
        model = self._settings.openrouter_tts_model
        if self._model_uses_openrouter_speech_endpoint(model):
            return self._synthesize_openrouter_speech_api(text, phase, resolved)
        return self._synthesize_openrouter_chat_audio(text, phase, resolved)

    async def synthesize(
        self,
        text: str,
        phase: InterviewPhase,
        voice: str | None = None,
    ) -> SpeechResponse:
        return await asyncio.to_thread(self._synthesize_sync, text, phase, voice)
