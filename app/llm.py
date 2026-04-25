from openai import OpenAI

from app.config import Settings


class OpenRouterClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = OpenAI(
            api_key=settings.openrouter_api_key,
            base_url=settings.openrouter_base_url,
        )

    def chat(self, system_prompt: str, messages: list[dict[str, str]]) -> str:
        completion = self._client.chat.completions.create(
            model=self._settings.openrouter_model,
            temperature=self._settings.openrouter_temperature,
            extra_headers={
                "HTTP-Referer": self._settings.openrouter_http_referer,
                "X-Title": self._settings.openrouter_app_title,
            },
            messages=[{"role": "system", "content": system_prompt}, *messages],
        )
        return completion.choices[0].message.content or ""
