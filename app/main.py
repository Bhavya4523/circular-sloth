from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.models import (
    ReadRequest,
    ReadResult,
    ReplyRequest,
    ReplyResult,
    SummaryRequest,
    SummaryResult,
)
from app.provider import ModelProvider, ProviderError, configuration, health_probe, provider

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
request_logger = logging.getLogger("request_metrics")
VERSION = os.getenv("APP_VERSION", "0.1.0")
MAX_CHARS = int(os.getenv("MAX_CHARS", "24000"))
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_HOUR", "40"))
RATE_WINDOW = 3600
_requests: dict[str, deque[float]] = defaultdict(deque)
_health_cache: tuple[float, dict[str, Any]] | None = None
_health_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await provider.close()


app = FastAPI(title="Circular Sloth API", version=VERSION, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=500)
if os.getenv("APP_ENV", "production").lower() == "development":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )


@app.middleware("http")
async def privacy_security_and_metrics(request: Request, call_next):
    started = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000
        if request.url.path.startswith("/api/"):
            request_logger.info("status=%d latency_ms=%.1f", status, elapsed_ms)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:"
    return response


@app.middleware("http")
async def per_ip_rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        bucket = _requests[key]
        while bucket and now - bucket[0] >= RATE_WINDOW:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT:
            response = JSONResponse({"detail": "Too many requests. Please try again later."}, status_code=429)
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "no-referrer"
            return response
        bucket.append(now)
    return await call_next(request)


def _model_error(exc: ProviderError) -> HTTPException:
    if exc.busy:
        return HTTPException(status_code=503, detail="The reader is busy, trying again...")
    return HTTPException(status_code=502 if exc.status_code != 503 else 503, detail=str(exc))


@app.get("/api/health")
async def health() -> dict[str, Any]:
    global _health_cache
    now = time.monotonic()
    if _health_cache and now - _health_cache[0] < 30:
        return _health_cache[1]
    async with _health_lock:
        now = time.monotonic()
        if _health_cache and now - _health_cache[0] < 30:
            return _health_cache[1]
        cfg = configuration()
        try:
            reachable, model_status = await health_probe()
        except (ValueError, ProviderError) as exc:
            reachable, model_status = False, str(exc)
        result = {
            "status": "busy" if reachable and model_status == "busy" else ("ok" if reachable else "degraded"),
            "provider": cfg["provider"],
            "model": cfg["model"],
            "model_reachable": reachable,
            "model_status": model_status,
            "version": VERSION,
        }
        _health_cache = (time.monotonic(), result)
        return result


@app.post("/api/read", response_model=ReadResult)
async def read_circular(payload: ReadRequest) -> ReadResult:
    if sum(len(chunk.text) for chunk in payload.chunks) > MAX_CHARS:
        raise HTTPException(status_code=413, detail=f"Circular text exceeds the {MAX_CHARS} character limit.")
    today = payload.today.isoformat()
    language = payload.language_hint or "the language present in the circular"
    system = (
        "You read school circulars in English, Hindi, Marathi, and Hinglish. Return JSON with items and warnings. "
        "Extract only actionable or schedule-affecting information; ignore greetings, forwarded chatter, and signatures. "
        "Resolve relative dates against the supplied today date and output ISO dates. Understand rupee formats (Rs, ₹, /-). "
        "Put a mentioned rupee amount in amount as an integer number of rupees, not null. Put any explicit event or due date in date as YYYY-MM-DD, including for payment deadlines; never leave date null when a date appears in that item's source text. Use end_date only for a stated range. "
        "Keep titles in their original language. Set audience precisely when a class is named, otherwise all. "
        "Never invent information. Unclear information should be info with low confidence and a warning. "
        "Each item must include chunk_id,type,title,details,date,end_date,time,amount,audience,confidence,source_text. "
        "Types are wear,bring,pay,sign,attend,holiday,deadline,info. Return no prose outside JSON."
    )
    user = f"today={today}; language_hint={language}\nchunks={payload.model_dump_json(include={'chunks'})}"
    try:
        return await provider.generate(system, user, ReadResult)
    except ProviderError as exc:
        raise _model_error(exc) from exc


@app.post("/api/summary", response_model=SummaryResult)
async def summary(payload: SummaryRequest) -> SummaryResult:
    system = "Write a concise Sunday summary for a parent in the requested language. Return exactly 3 short lines as JSON {lines:[...]}. Do not invent facts."
    user = payload.model_dump_json()
    try:
        return await provider.generate(system, user, SummaryResult)
    except ProviderError as exc:
        raise _model_error(exc) from exc


@app.post("/api/reply", response_model=ReplyResult)
async def reply(payload: ReplyRequest) -> ReplyResult:
    # Deliberately omit optional labels to avoid transmitting a child's name or identity.
    user = f"language={payload.language}\nintent={payload.intent}"
    system = "Draft a short, polite plain-text WhatsApp reply to a school teacher. Return JSON {message:string}. Use at most one folded-hands emoji and do not invent details."
    try:
        return await provider.generate(system, user, ReplyResult)
    except ProviderError as exc:
        raise _model_error(exc) from exc


web_dir = Path(__file__).resolve().parent.parent / "web" / "dist"
if web_dir.is_dir():
    app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")
