from __future__ import annotations

import asyncio
import httpx
import pytest
from fastapi.testclient import TestClient

from app import main
from app.models import ExtractedItem, ReadResult, ReplyResult, SummaryResult
from app.provider import ModelProvider, ProviderError, _repair_json


def test_json_repair_strips_fence_prose_and_trailing_comma():
    source = 'Here is the result:\n```json\n{"lines":["one","two","three",],}\n```'
    result = SummaryResult.model_validate_json(_repair_json(source))
    assert result.lines == ["one", "two", "three"]


def test_schema_validation_rejects_unknown_item_type():
    with pytest.raises(ValueError):
        ReadResult.model_validate({"items": [{"chunk_id": "a", "type": "unknown", "title": "x", "confidence": 0.5, "source_text": "x"}], "warnings": []})


def test_explicit_source_values_are_normalized_to_fields():
    item = ExtractedItem.model_validate({
        "chunk_id": "a", "type": "pay", "title": "Fee", "source_text": "Fee Rs 871/- payable by 28 January 2027",
        "confidence": 1.0,
    })
    assert item.amount == 871
    assert item.date.isoformat() == "2027-01-28"


def test_provider_retries_429_then_succeeds(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compat")
    monkeypatch.setenv("MODEL_NAME", "model")
    calls = 0
    waits = []

    async def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"message":"Thanks."}'}}]})

    async def sleep(seconds):
        waits.append(seconds)

    async def run():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        instance = ModelProvider(client=client, sleep=sleep)
        result = await instance.generate("system", "user", ReplyResult)
        await client.aclose()
        return result

    result = asyncio.run(run())
    assert result.message == "Thanks."
    assert calls == 2 and waits == [0.0]


def test_provider_429_four_attempts_reports_busy(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compat")
    monkeypatch.setenv("MODEL_NAME", "model")
    calls = 0

    async def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(429)

    async def sleep(_):
        return None

    async def run():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        instance = ModelProvider(client=client, sleep=sleep)
        try:
            await instance.generate("system", "user", ReplyResult)
        finally:
            await client.aclose()

    with pytest.raises(ProviderError) as error:
        asyncio.run(run())
    assert error.value.busy
    assert calls == 4


def test_read_limits_headers_and_never_logs_request_or_api_key(monkeypatch, caplog):
    monkeypatch.setenv("API_KEY", "sentinel-secret-for-test")
    monkeypatch.setattr(main, "MAX_CHARS", 5)
    main._health_cache = None

    async def fake_generate(system, user, schema):
        return schema.model_validate({"items": [], "warnings": []})

    monkeypatch.setattr(main.provider, "generate", fake_generate)
    with TestClient(main.app) as client:
        too_long = client.post("/api/read", json={"today": "2026-10-21", "chunks": [{"id": "1", "text": "secret body"}]})
        assert too_long.status_code == 413
        monkeypatch.setattr(main, "MAX_CHARS", 1000)
        response = client.post("/api/read", json={"today": "2026-10-21", "chunks": [{"id": "1", "text": "private circular text"}]})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
    assert "private circular text" not in caplog.text
    assert "sentinel-secret-for-test" not in caplog.text
    assert "sentinel-secret-for-test" not in response.text


def test_reply_omits_child_and_teacher_labels_from_model_input(monkeypatch):
    observed = {}

    async def fake_generate(system, user, schema):
        observed["user"] = user
        return schema.model_validate({"message": "Thank you."})

    monkeypatch.setattr(main.provider, "generate", fake_generate)
    with TestClient(main.app) as client:
        response = client.post("/api/reply", json={"language": "english", "intent": "I will attend.", "child_label": "PRIVATE CHILD", "teacher_label": "PRIVATE TEACHER"})
    assert response.status_code == 200
    assert "PRIVATE CHILD" not in observed["user"]
    assert "PRIVATE TEACHER" not in observed["user"]


def test_summary_endpoint_uses_provider_and_returns_three_lines(monkeypatch):
    async def fake_generate(system, user, schema):
        assert "week_start" in user
        return schema.model_validate({"lines": ["One", "Two", "Three"]})

    monkeypatch.setattr(main.provider, "generate", fake_generate)
    with TestClient(main.app) as client:
        response = client.post("/api/summary", json={"language": "english", "week_start": "2026-10-19", "items": []})
    assert response.status_code == 200
    assert len(response.json()["lines"]) == 3


def test_health_reports_model_unreachable(monkeypatch):
    async def offline():
        return False, "connection refused"

    monkeypatch.setattr(main, "health_probe", offline)
    main._health_cache = None
    with TestClient(main.app) as client:
        response = client.get("/api/health")
    assert response.json()["model_reachable"] is False
    assert response.json()["model_status"] == "connection refused"


def test_health_reports_busy_as_reachable(monkeypatch):
    async def busy():
        return True, "busy"

    monkeypatch.setattr(main, "health_probe", busy)
    main._health_cache = None
    with TestClient(main.app) as client:
        response = client.get("/api/health")
    assert response.json()["status"] == "busy"
    assert response.json()["model_reachable"] is True


def test_per_ip_hourly_rate_limit(monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT", 1)
    main._requests.clear()

    async def fake_generate(system, user, schema):
        return schema.model_validate({"message": "Thanks."})

    monkeypatch.setattr(main.provider, "generate", fake_generate)
    body = {"language": "english", "intent": "I will attend."}
    with TestClient(main.app) as client:
        first = client.post("/api/reply", json=body)
        second = client.post("/api/reply", json=body)
    assert first.status_code == 200
    assert second.status_code == 429


def test_global_model_semaphore_limits_concurrency(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compat")
    monkeypatch.setenv("MODEL_NAME", "model")
    active = 0
    peak = 0

    async def handler(request):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"message":"ok"}'}}]})

    async def run():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        instance = ModelProvider(client=client)
        await asyncio.gather(*(instance.generate("s", "u", ReplyResult) for _ in range(5)))
        await client.aclose()

    asyncio.run(run())
    assert peak <= 2
