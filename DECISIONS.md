# Decisions

- The repo had no application files at kickoff. The existing root `.env` is user-owned and is excluded by `.gitignore`; its contents are never printed or copied.
- Phase 1 provides a minimal static landing page so the Docker image serves one web service before the React frontend is built in Phase 2.
- The hosted reply endpoint deliberately omits optional child/teacher labels from model input to honor the data-minimization rule.
- Model calls use structured JSON response formats where supported, with JSON cleanup and one stricter retry for malformed output.
- The smoke script injects a random rupee amount and future date at runtime, then checks that exactly one returned item contains both.
