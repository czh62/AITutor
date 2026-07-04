Status: DONE

Tests run, with exact commands and results:
- `pytest tests/test_mastery_api_documents.py -q` -> failed during collection with `ModuleNotFoundError: No module named 'src'`
- `PYTHONPATH=. pytest tests/test_mastery_api_documents.py -q` -> failed during collection with `ImportError: cannot import name 'validate_mastery_upload_file' from 'src.api.documents'`
- `PYTHONPATH=. pytest tests/test_mastery_api_documents.py -q` -> passed, `9 passed in 0.28s`
- `PYTHONPATH=. pytest tests -q` -> passed, `17 passed in 0.30s`
- `cd ui && npm run lint` -> passed, exit code 0 (`tsc --noEmit`)

Commits created:
- `91f7961` — `feat: validate mastery upload inputs`

Files changed:
- `/Users/moon/code/AITutor/src/core/config.py`
- `/Users/moon/code/AITutor/src/schemas/documents.py`
- `/Users/moon/code/AITutor/src/services/lightrag_client.py`
- `/Users/moon/code/AITutor/src/api/documents.py`
- `/Users/moon/code/AITutor/tests/test_mastery_api_documents.py`
- `/Users/moon/code/AITutor/.superpowers/sdd/task-1-report.md`

Self-review notes:
- Added upload validation with the exact extension and MIME allowlist from the brief.
- Kept `mastery_service` optional via `getattr(request.app.state, "mastery_service", None)` and only call `register_upload(...)` for successful uploads with a `track_id`.
- Added `track_id` to `UploadResult` and introduced `TrackStatusResponse` plus `LightRAGClient.get_track_status()` for the next slice to consume.
- Test harness needed the same lightweight `pydantic_settings` shim pattern already used elsewhere in `tests/` so the new tests could fail for the intended missing-feature reason in this environment.

Any concerns:
- The brief’s exact red-step command (`pytest tests/test_mastery_api_documents.py -q`) does not work in this checkout without `PYTHONPATH=.` because `src` is not importable otherwise. I recorded both the literal command result and the corrected TDD verification run.

---

Reviewer follow-up fix:

Status: DONE

Scope:
- Updated only `/Users/moon/code/AITutor/tests/test_mastery_api_documents.py`
- No backend implementation change was needed after verifying the existing Task 1 router behavior

Reviewer findings covered with direct `src.api.documents.upload_document()` tests:
- registers only when `raw["status"] == "success"` and `track_id` is present
- does not register on `partial_success`
- does not register on `failure`
- does not register when `track_id` is missing or empty
- does not fail when `mastery_service` is `None`
- does not create a Mastery build job when `LightRAGClient.upload_document()` raises `ConflictError`

Test runs:
- `PYTHONPATH=. pytest tests/test_mastery_api_documents.py -q` -> passed, `14 passed in 0.30s`
- `PYTHONPATH=. pytest tests -q` -> passed, `22 passed in 0.27s`

TDD note:
- Added the reviewer-requested direct side-effect tests first, then ran `PYTHONPATH=. pytest tests/test_mastery_api_documents.py -q`.
- The new tests passed immediately, which verified the current `src/api/documents.py` implementation already satisfied the required registration/409 behavior, so no production code change was applied.
