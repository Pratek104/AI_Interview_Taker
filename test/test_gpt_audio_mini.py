"""
Exercise openai/gpt-audio-mini through OpenRouter the same way as app.speech.SpeechService.

Run from the repository root (so `app` imports work and `.env` is found):

    python test/test_gpt_audio_mini.py

    python test/test_gpt_audio_mini.py --text "Your sample sentence here."

Requires OPENROUTER_API_KEY and the same TTS-related vars as the app
(see .env.example: OPENROUTER_TTS_MODEL, OPENROUTER_TTS_VOICE, etc.).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import sys
from pathlib import Path

# Repo root on sys.path when running as `python test/test_gpt_audio_mini.py`
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.config import get_settings  # noqa: E402
from app.models import InterviewPhase  # noqa: E402
from app.speech import SpeechService  # noqa: E402


async def _run(text: str, output: Path | None) -> Path:
    settings = get_settings()
    if settings.openrouter_tts_model.lower() != "openai/gpt-audio-mini":
        print(
            f"Note: OPENROUTER_TTS_MODEL is {settings.openrouter_tts_model!r} "
            f"(expected openai/gpt-audio-mini for this test name).",
            file=sys.stderr,
        )

    service = SpeechService(settings)
    response = await service.synthesize(text, InterviewPhase.QNA, voice=settings.openrouter_tts_voice)

    fmt = settings.openrouter_tts_audio_format
    out = output or (Path(__file__).resolve().parent / f"gpt_audio_mini_sample.{fmt}")
    raw = base64.b64decode(response.audio_base64)
    out.write_bytes(raw)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate sample audio via OpenRouter gpt-audio-mini.")
    parser.add_argument(
        "--text",
        default="Hello. This is a short test of OpenAI GPT Audio Mini through OpenRouter.",
        help="Text for the model to speak.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output file path (default: test/gpt_audio_mini_sample.<format>).",
    )
    args = parser.parse_args()

    out_path = asyncio.run(_run(args.text, args.output))
    size = out_path.stat().st_size
    print(f"Wrote {out_path} ({size} bytes)")


if __name__ == "__main__":
    main()
