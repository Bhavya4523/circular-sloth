# Circular Sloth

## Project summary
Circular Sloth helps parents turn school circulars into reviewed action items while keeping family records in the browser. The backend is stateless and sends only circular text, today's date, and a language hint to the configured open-weight model provider. Photos stay on the device.

## Tech stack
- Backend: Python 3.11, FastAPI, Uvicorn, Pydantic v2, httpx, python-dotenv.
- Frontend: React, Vite, TypeScript, CSS variables, React Router, Dexie, vite-plugin-pwa with injectManifest.
- OCR/PDF: browser-based tesseract.js and pdfjs-dist with self-hosted assets.
- Deployment: multi-stage Docker image and Render Blueprint; no database or persistent disk.

## Data ownership rules (section 2)
- The server is stateless: no database, accounts, sessions, cookies, or request-data disk writes. Do not log request text; log only status and latency.
- Records belong only in the visitor's browser IndexedDB (Dexie). Images are not stored; OCR runs in the browser and discards the image.
- Preserve browser persistent-storage status, encrypted backup/restore, backup reminders, optional local PIN lock, and confirmed delete-all behavior.
- Explain that people sharing a browser profile share its data. In hosted mode, extracted text (never photos) goes to the configured third-party provider momentarily; provider policies apply.
- Minimize model input to circular text, today's date, and language hint. Never send a child's name; class labels are matched on-device.

## Real-model rule (section 3)
- No demo mode and no canned model output. All reading, summary, reply, and health checks use a real configured model. A sample circular is text sent to that real model.
- Support open-weight models only through `openai_compat` or local Ollama. Validate provider output, strip JSON fences/prose, attempt repair, retry once with a stricter prompt, and return clear errors instead of crashing.
- Retry 429/5xx with increasing waits and honor Retry-After. Limit concurrent model calls to two. Keep health checks and smoke tests on the same provider/retry logic.
- Keep API keys in environment variables; never print, log, echo, commit, or copy their values.

## Design rules (section 7)
- Build a human school-diary/fridge-door visual language, mobile first, calm and readable.
- Use the exact design tokens from the project brief: paper #FBFCFA, grid #DCE6EB, ink #1B2430, ink-soft #566170, pond #167A8B, marker #FFE14D, tomato #E5533D, eraser #FFC8D0, sky #BFE3F2, peach #FFD2A8, leaf #3C8D5A.
- No gradients, glassmorphism, neon, purple/blue-violet, dark-by-default, generic SaaS cards, emoji-heavy UI, icon libraries, or system/Inter/Roboto typography. Use Baloo 2, Palanquin, and Kalam self-hosted.
- Use >=17px body text, WCAG AA contrast, visible focus, accessible labels, >=48px targets, and reduced-motion support. Never convey item type by color alone.

## Commands
- Create a Python 3.11 virtual environment: `py -3.11 -m venv .venv`
- Install backend dependencies: `.venv/Scripts/python.exe -m pip install -r requirements.txt`
- Run API: `.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
- Run backend tests: `.venv/Scripts/python.exe -m pytest`
- Local real-model smoke: `.venv/Scripts/python.exe scripts/smoke_live.py http://127.0.0.1:8000`
- Docker build: `docker build -t circular-sloth:local .`
- Frontend build (after frontend is added): `npm run build`

Re-read this file at the start of every phase.
