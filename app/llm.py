from openai import OpenAI

from app.config import Settings


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        use_groq = (
            settings.llm_provider == "groq"
            or not (settings.openrouter_api_key or "").strip()
        )
        if use_groq:
            api_key = (settings.groq_api_key or "").strip()
            if not api_key:
                raise ValueError("GROQ_API_KEY is required for Groq LLM provider.")
            self._client = OpenAI(
                api_key=api_key,
                base_url=settings.groq_base_url,
            )
            self._model = settings.groq_llm_model
            self._is_groq = True
        else:
            self._client = OpenAI(
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
            )
            self._model = settings.openrouter_model
            self._is_groq = False

    def chat(self, system_prompt: str, messages: list[dict[str, str]]) -> str:
        extra_headers = None
        if not self._is_groq:
            extra_headers = {
                "HTTP-Referer": self._settings.openrouter_http_referer,
                "X-Title": self._settings.openrouter_app_title,
            }
        completion = self._client.chat.completions.create(
            model=self._model,
            temperature=self._settings.openrouter_temperature,
            extra_headers=extra_headers,
            messages=[{"role": "system", "content": system_prompt}, *messages],
        )
        return completion.choices[0].message.content or ""


OpenRouterClient = LLMClient
