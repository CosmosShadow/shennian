#!/usr/bin/env python3
"""
Minimal Shennian custom agent in plain Python.

Features:
- no SDK
- /caps + /run
- models + defaultModel
- resume with local JSON session storage
- DeepSeek OpenAI-compatible API

Register:
  shennian agent add demo-python --command "python3 /path/to/agent.py"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path


HERE = Path(__file__).resolve().parent


def emit(event: dict) -> None:
    print(json.dumps(event, ensure_ascii=False))
    sys.stdout.flush()


def load_dotenv(file_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not file_path.exists():
        return values
    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        values[key.strip()] = value
    return values


def get_config() -> dict[str, object]:
    file_env = load_dotenv(HERE / ".env")

    def read(key: str, fallback: str = "") -> str:
        return os.environ.get(key) or file_env.get(key) or fallback

    default_model = read("DEEPSEEK_DEFAULT_MODEL", "deepseek-chat")
    reasoner_model = read("DEEPSEEK_REASONER_MODEL", "deepseek-reasoner")
    session_dir = read("SESSION_DIR", str(HERE / ".sessions"))

    return {
        "api_key": read("DEEPSEEK_API_KEY"),
        "base_url": read("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        "system_prompt": read(
            "DEEPSEEK_SYSTEM_PROMPT",
            "You are a concise custom agent demo for Shennian.",
        ),
        "default_model": default_model,
        "models": list(dict.fromkeys([default_model, reasoner_model])),
        "session_dir": Path(session_dir).resolve(),
    }


def session_file(session_dir: Path, session_id: str) -> Path:
    return session_dir / f"{session_id}.json"


def load_session_messages(session_dir: Path, session_id: str) -> list[dict[str, str]]:
    file_path = session_file(session_dir, session_id)
    if not file_path.exists():
        return []
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        messages = payload.get("messages", [])
        return messages if isinstance(messages, list) else []
    except json.JSONDecodeError:
        return []


def save_session_messages(session_dir: Path, session_id: str, messages: list[dict[str, str]]) -> None:
    session_dir.mkdir(parents=True, exist_ok=True)
    session_file(session_dir, session_id).write_text(
        json.dumps({"messages": messages}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def call_deepseek(*, api_key: str, base_url: str, model: str, messages: list[dict[str, str]]) -> tuple[str, dict[str, int]]:
    if not api_key:
        raise RuntimeError("Missing DEEPSEEK_API_KEY. Fill examples/python/.env before running the demo.")

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        data=json.dumps(
            {
                "model": model,
                "messages": messages,
                "stream": False,
                "temperature": 0.2,
            }
        ).encode("utf-8"),
    )

    try:
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"DeepSeek request failed with {exc.code}: {body}") from exc

    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    return (
        content if isinstance(content, str) else json.dumps(content, ensure_ascii=False),
        {
            "inputTokens": int(payload.get("usage", {}).get("prompt_tokens", 0)),
            "outputTokens": int(payload.get("usage", {}).get("completion_tokens", 0)),
        },
    )


def caps() -> None:
    config = get_config()
    emit(
        {
            "name": "DeepSeek Demo (Python)",
            "model": config["default_model"],
            "models": config["models"],
            "defaultModel": config["default_model"],
            "mode": "spawn",
            "resume": True,
            "version": "1.0.0",
        }
    )


def run(workdir: str, session: str | None, resume: str | None, model: str | None, attachments: list[str]) -> None:
    _ = (workdir, attachments)
    config = get_config()
    agent_session_id = resume or session or str(uuid.uuid4())
    history = load_session_messages(config["session_dir"], agent_session_id)
    user_text = sys.stdin.read().strip()

    messages = [{"role": "system", "content": config["system_prompt"]}, *history, {"role": "user", "content": user_text}]
    reply_text, usage = call_deepseek(
        api_key=str(config["api_key"]),
        base_url=str(config["base_url"]),
        model=model or str(config["default_model"]),
        messages=messages,
    )

    next_history = [*history, {"role": "user", "content": user_text}, {"role": "assistant", "content": reply_text}]
    save_session_messages(config["session_dir"], agent_session_id, next_history)

    emit({"state": "delta", "text": reply_text})
    emit({"state": "final", "usage": usage, "agentSessionId": agent_session_id})


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: agent.py /caps | /run --workdir=<path> [--resume <id>] [--model <id>]", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]

    if command == "/caps":
        caps()
        return

    if command == "/run":
        parser = argparse.ArgumentParser()
        parser.add_argument("--workdir", required=True)
        parser.add_argument("--session", default=None)
        parser.add_argument("--resume", default=None)
        parser.add_argument("--model", default=None)
        parser.add_argument("--attachment", action="append", default=[])
        args = parser.parse_args(sys.argv[2:])
        try:
            run(args.workdir, args.session, args.resume, args.model, args.attachment)
        except Exception as exc:  # noqa: BLE001
            emit({"state": "error", "message": str(exc)})
        return

    print(f"Unknown command: {command}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
