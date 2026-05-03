"""
Smoke-test Groq Orpheus English TTS (same path as app.speech.SpeechService with TTS_PROVIDER=groq).

From repo root:

    python test/test_groq_orpheus_tts.py

Requires GROQ_API_KEY and TTS_PROVIDER=groq in .env (see .env.example).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.config import get_settings  # noqa: E402
from app.models import InterviewPhase  # noqa: E402
from app.speech import SpeechService  # noqa: E402


async def _run(text: str, output: Path | None) -> Path:
    settings = get_settings()
    if settings.tts_provider != "groq":
        print(
            f"Note: TTS_PROVIDER is {settings.tts_provider!r}; "
            "set TTS_PROVIDER=groq in .env to match this script.",
            file=sys.stderr,
        )

    service = SpeechService(settings)
    response = await service.synthesize(
        text,
        InterviewPhase.QNA,
        voice=settings.groq_tts_voice,
    )

    out = output or (Path(__file__).resolve().parent / "groq_orpheus_sample.wav")
    out.write_bytes(base64.b64decode(response.audio_base64))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Groq Orpheus English TTS sample (WAV).")
    parser.add_argument(
        "--text",
        default="Hello. This is a test of Canopy Labs Orpheus on Groq.",
        help="Text to speak (long text is split into 200-character segments automatically).",
    )
    parser.add_argument("-o", "--output", type=Path, default=None)
    args = parser.parse_args()

    path = asyncio.run(_run(args.text, args.output))
    print(f"Wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
