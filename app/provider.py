from __future__ import annotations

import asyncio
import json
import os
import re
import ssl
import time
from dataclasses import dataclass
from typing import Any, TypeVar

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

load_dotenv()
T = TypeVar("T", bound=BaseModel)
RETRY_DELAYS = (2.0, 5.0, 10.0)
MODEL_SEMAPHORE = asyncio.Semaphore(2)


@dataclass
class ProviderError(Exception):
    message: str
    status_code: int | None = None
    busy: bool = False

    def __str__(self) -> str:
        return self.message


def configuration() -> dict[str, str]:
    provider = os.getenv("LLM_PROVIDER", "openai_compat").strip().lower()
    if provider not in {"openai_compat", "ollama"}:
        raise ValueError("LLM_PROVIDER must be openai_compat or ollama")
    defaults = {
        "openai_compat": "https://openrouter.ai/api/v1",
        "ollama": "http://localhost:11434",
    }
    return {
        "provider": provider,
        "base_url": os.getenv("BASE_URL", defaults[provider]).rstrip("/"),
        "model": os.getenv("MODEL_NAME", "gemma3:4b" if provider == "ollama" else "").strip(),
        "api_key": os.getenv("API_KEY", ""),
        "fallback_model": os.getenv("FALLBACK_MODEL_NAME", "").strip(),
        "timeout": os.getenv("REQUEST_TIMEOUT_S", "120"),
    }


def _json_candidate(content: str) -> str:
    text = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", content.strip(), flags=re.I)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return text


def _repair_json(text: str) -> str:
    candidate = _json_candidate(text)
    # Common harmless model slips: trailing commas and smart quotes.
    candidate = candidate.replace("“", '"').replace("”", '"').replace("’", "'")
    candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
    return candidate


class ModelProvider:
    def __init__(self, *, client: httpx.AsyncClient | None = None, sleep=asyncio.sleep):
        # Build from the OS trust store without inheriting SSLKEYLOGFILE into a
        # proxy-owned path (some managed Windows images expose a protected one).
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        tls.load_default_certs()
        self.client = client or httpx.AsyncClient(verify=tls)
        self._owns_client = client is None
        self.sleep = sleep

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    async def _request(
        self, messages: list[dict[str, str]], model: str | None = None,
        response_schema: dict[str, Any] | None = None,
    ) -> str:
        cfg = configuration()
        selected_model = model or cfg["model"]
        if not selected_model:
            raise ProviderError("MODEL_NAME is not configured", status_code=503)
        is_ollama = cfg["provider"] == "ollama"
        url = f"{cfg['base_url']}/api/chat" if is_ollama else f"{cfg['base_url']}/chat/completions"
        headers = {} if is_ollama else ({"Authorization": f"Bearer {cfg['api_key']}"} if cfg["api_key"] else {})
        body: dict[str, Any] = {"model": selected_model, "messages": messages, "stream": False}
        if is_ollama:
            body["format"] = response_schema or "json"
        else:
            body["response_format"] = (
                {"type": "json_schema", "json_schema": {"name": "circular_sloth_response", "strict": True, "schema": response_schema}}
                if response_schema else {"type": "json_object"}
            )

        last_error: ProviderError | None = None
        for attempt in range(4):
            try:
                response = await self.client.post(
                    url,
                    json=body,
                    headers=headers,
                    timeout=float(cfg["timeout"]),
                )
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = ProviderError(f"Model provider connection failed ({type(exc).__name__})", status_code=503)
                if attempt < len(RETRY_DELAYS):
                    await self.sleep(RETRY_DELAYS[attempt])
                    continue
                raise last_error from exc
            if response.status_code == 429 or response.status_code >= 500:
                last_error = ProviderError(
                    f"Model provider is busy (HTTP {response.status_code})",
                    status_code=response.status_code,
                    busy=True,
                )
                if attempt < len(RETRY_DELAYS):
                    retry_after = response.headers.get("Retry-After")
                    try:
                        delay = max(0.0, float(retry_after)) if retry_after else RETRY_DELAYS[attempt]
                    except ValueError:
                        delay = RETRY_DELAYS[attempt]
                    await self.sleep(delay)
                    continue
                raise last_error
            if response.status_code >= 400:
                raise ProviderError(
                    f"Model provider rejected the request (HTTP {response.status_code})",
                    status_code=response.status_code,
                )
            try:
                payload = response.json()
                return payload["message"]["content"] if is_ollama else payload["choices"][0]["message"]["content"]
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                raise ProviderError("Model provider returned an unreadable response", status_code=502) from exc
        assert last_error is not None
        raise last_error

    async def generate(self, system: str, user: str, schema: type[T]) -> T:
        async with MODEL_SEMAPHORE:
            messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
            errors: list[str] = []
            last_provider_error: ProviderError | None = None
            cfg = configuration()
            models = [cfg["model"]]
            if cfg["fallback_model"] and cfg["fallback_model"] != cfg["model"]:
                models.append(cfg["fallback_model"])
            for model in models:
                for strict_attempt in range(2):
                    if strict_attempt:
                        messages = [*messages, {"role": "system", "content": "Return only valid JSON matching the requested schema. Do not include prose or markdown."}]
                    try:
                        raw = await self._request(messages, model=model, response_schema=schema.model_json_schema())
                    except ProviderError as exc:
                        errors.append(type(exc).__name__)
                        last_provider_error = exc
                        break
                    try:
                        return schema.model_validate_json(_json_candidate(raw))
                    except (ValidationError, ValueError):
                        try:
                            return schema.model_validate_json(_repair_json(raw))
                        except (ValidationError, ValueError) as exc:
                            errors.append(type(exc).__name__)
            if last_provider_error:
                raise last_provider_error
            raise ProviderError("The model returned information that could not be read as valid JSON.", status_code=502)


provider = ModelProvider()


async def health_probe() -> tuple[bool, str]:
    started = time.monotonic()
    try:
        await provider._request([
            {"role": "system", "content": "Return only JSON."},
            {"role": "user", "content": 'Reply with {"ok":true}.'},
        ])
        return True, "ready"
    except ProviderError as exc:
        if exc.busy:
            return True, "busy"
        return False, exc.message
    finally:
        _ = time.monotonic() - started

