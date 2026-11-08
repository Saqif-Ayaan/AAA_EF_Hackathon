"""All model calls go through headless Claude Code (`claude -p`). See RAG_SPEC.md, "How we call models".

No API key is used: calls run on the developer's Claude Code login.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

FAST_MODEL = os.environ.get("RAG_FAST_MODEL", "claude-haiku-5-5")
FAST_EFFORT = os.environ.get("RAG_FAST_EFFORT", "medium")
STRONG_MODEL = os.environ.get("RAG_STRONG_MODEL", "claude-opus-5")
STRONG_EFFORT = os.environ.get("RAG_STRONG_EFFORT", "medium")

CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
CALL_TIMEOUT_S = int(os.environ.get("RAG_CALL_TIMEOUT", "900"))
ATTEMPTS = 3
WORKERS = int(os.environ.get("RAG_WORKERS", "6"))

# Empty working directory so no project CLAUDE.md / hooks / settings leak into prompts.
_SANDBOX = Path(tempfile.mkdtemp(prefix="rag-claude-p-"))

T = TypeVar("T", bound=BaseModel)


class CallFailed(Exception):
    pass


class _Usage:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.by_model: dict[str, dict[str, float]] = {}

    def add(self, result: dict) -> None:
        with self.lock:
            for model, u in (result.get("modelUsage") or {}).items():
                d = self.by_model.setdefault(
                    model, {"calls": 0, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "cost_usd": 0.0}
                )
                d["calls"] += 1
                d["input"] += u.get("inputTokens", 0)
                d["output"] += u.get("outputTokens", 0)
                d["cache_read"] += u.get("cacheReadInputTokens", 0)
                d["cache_write"] += u.get("cacheCreationInputTokens", 0)
                d["cost_usd"] = round(d["cost_usd"] + u.get("costUSD", 0.0), 4)

    def report(self) -> str:
        return "\n".join(f"  {m}: {d}" for m, d in self.by_model.items()) or "  (no calls)"


usage = _Usage()


def _system_text(system: list[dict] | str) -> str:
    # Stages pass API-style text blocks; the CLI takes one system prompt (cached automatically).
    if isinstance(system, str):
        return system
    return "\n\n".join(b["text"] for b in system)


def _once(model: str, effort: str, system: str, user: str, schema_json: str) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", dir=_SANDBOX, delete=False) as f:
        f.write(system)
        sys_path = f.name
    try:
        cmd = [
            CLAUDE_BIN, "-p",
            "--model", model,
            "--effort", effort,
            "--system-prompt-file", sys_path,
            "--json-schema", schema_json,
            "--output-format", "json",
            "--tools", "",
            "--strict-mcp-config",
            "--no-session-persistence",
        ]
        proc = subprocess.run(
            cmd, input=user, capture_output=True, text=True, cwd=_SANDBOX, timeout=CALL_TIMEOUT_S
        )
    finally:
        os.unlink(sys_path)

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise CallFailed(f"exit {proc.returncode}; non-JSON output: {(proc.stdout or proc.stderr)[:400]}")
    usage.add(result)
    if result.get("is_error") or proc.returncode != 0:
        raise CallFailed(f"exit {proc.returncode}; {result.get('subtype')}: {str(result.get('result'))[:400]}")
    if result.get("structured_output") is None:
        raise CallFailed(f"no structured_output (stop_reason={result.get('stop_reason')})")
    return result["structured_output"]


def parse(*, model: str, system: list[dict] | str, user: str, schema: type[T], effort: str | None = None) -> T:
    effort = effort or (FAST_EFFORT if model == FAST_MODEL else STRONG_EFFORT)
    schema_json = json.dumps(schema.model_json_schema())
    sys_text = _system_text(system)
    last: Exception | None = None
    for attempt in range(ATTEMPTS):
        try:
            return schema.model_validate(_once(model, effort, sys_text, user, schema_json))
        except (CallFailed, ValidationError, subprocess.TimeoutExpired) as e:
            last = e
            time.sleep(5 * (attempt + 1))
    raise CallFailed(f"{schema.__name__} failed after {ATTEMPTS} attempts: {last}")
