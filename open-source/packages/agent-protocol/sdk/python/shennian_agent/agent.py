from __future__ import annotations

import json
import sys
import uuid
from collections.abc import Callable
from typing import Any, Optional

from .events import (
    DeltaEvent,
    ErrorEvent,
    FinalEvent,
    NotifyEvent,
    ToolCallEvent,
    ToolResultEvent,
    serialize,
)

SendHandler = Callable[[str, Optional[str], list[dict[str, str]]], None]
ResumeHandler = Callable[[str, str], None]



class Agent:
    def __init__(
        self,
        name: str,
        model: str,
        mode: str = "stdio",
        proactive: bool = False,
        resume: bool = False,
        version: str = "1.0.0",
    ) -> None:
        self.name = name
        self.model = model
        self.mode = mode
        self.proactive = proactive
        self._resume = resume
        self.version = version

        self._send_handler: SendHandler | None = None
        self._resume_handler: ResumeHandler | None = None
        self._run_id: str | None = None
        self._seq: int = 0
        self._agent_session_id: str | None = None

    def on_send(self, fn: SendHandler) -> SendHandler:
        self._send_handler = fn
        return fn

    def on_resume(self, fn: ResumeHandler) -> ResumeHandler:
        self._resume_handler = fn
        return fn

    def _new_run(self) -> None:
        self._run_id = str(uuid.uuid4())
        self._seq = 0

    def _emit(self, event_json: str) -> None:
        event = json.loads(event_json)
        if self._agent_session_id:
            event["agentSessionId"] = self._agent_session_id
        sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def delta(self, text: str, thinking: bool = False) -> None:
        if self._run_id is None:
            self._new_run()
        evt = DeltaEvent(text=text, run_id=self._run_id, seq=self._next_seq())
        if thinking:
            evt.thinking = True
        self._emit(serialize(evt))

    def tool_call(self, name: str, args: dict[str, Any] | None = None) -> None:
        if self._run_id is None:
            self._new_run()
        evt = ToolCallEvent(name=name, args=args, run_id=self._run_id, seq=self._next_seq())
        self._emit(serialize(evt))

    def tool_result(self, name: str, result: str) -> None:
        if self._run_id is None:
            self._new_run()
        evt = ToolResultEvent(name=name, result=result, run_id=self._run_id, seq=self._next_seq())
        self._emit(serialize(evt))

    def final(self, usage: dict[str, int] | None = None) -> None:
        if self._run_id is None:
            self._new_run()
        evt = FinalEvent(usage=usage, run_id=self._run_id, seq=self._next_seq())
        self._emit(serialize(evt))
        self._run_id = None
        self._seq = 0

    def error(self, message: str) -> None:
        if self._run_id is None:
            self._new_run()
        evt = ErrorEvent(message=message, run_id=self._run_id, seq=self._next_seq())
        self._emit(serialize(evt))
        self._run_id = None
        self._seq = 0

    def notify(self, text: str, title: str | None = None, source: str | None = None) -> None:
        evt = NotifyEvent(text=text, title=title, source=source)
        self._emit(serialize(evt))

    def run(self) -> None:
        if len(sys.argv) < 2:
            print(f"Usage: {sys.argv[0]} /caps | /run | /start", file=sys.stderr)
            sys.exit(1)

        cmd = sys.argv[1]
        if cmd == "/caps":
            self._handle_caps()
        elif cmd == "/run":
            self._handle_run()
        elif cmd == "/start":
            self._handle_start()
        else:
            print(f"Unknown command: {cmd}", file=sys.stderr)
            sys.exit(1)

    def _handle_caps(self) -> None:
        caps: dict[str, Any] = {
            "name": self.name,
            "model": self.model,
            "mode": self.mode,
            "version": self.version,
        }
        if self.proactive:
            caps["proactive"] = True
        if self._resume:
            caps["resume"] = True
        print(json.dumps(caps))

    def _handle_run(self) -> None:
        args = _parse_argv(sys.argv[2:])
        text = sys.stdin.read()
        self._new_run()
        resume_id = args.get("resume")
        self._agent_session_id = resume_id or str(uuid.uuid4())
        if resume_id:
            if self._resume_handler is None:
                self.error("resume not supported")
                return
            self._resume_handler(args.get("session", ""), resume_id)
        if self._send_handler is None:
            self.error("no handler registered")
            return
        self._send_handler(text, args.get("session"), args.get("attachments", []))

    def _handle_start(self) -> None:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue

            method = msg.get("method")
            params = msg.get("params", {})

            if method == "send":
                self._new_run()
                if self._agent_session_id is None:
                    self._agent_session_id = str(uuid.uuid4())
                if self._send_handler is None:
                    self.error("no handler registered")
                    continue
                attachments = params.get("attachments", [])
                self._send_handler(params.get("text", ""), params.get("sessionId"), attachments)

            elif method == "resume":
                if self._resume_handler is None:
                    self._new_run()
                    self.error("resume not supported")
                    continue
                self._new_run()
                self._agent_session_id = params.get("agentSessionId", "")
                self._resume_handler(params.get("sessionId", ""), params.get("agentSessionId", ""))

            elif method == "stop":
                break


def _parse_argv(argv: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {"attachments": []}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg.startswith("--workdir="):
            result["workdir"] = arg.split("=", 1)[1]
        elif arg == "--workdir" and i + 1 < len(argv):
            i += 1
            result["workdir"] = argv[i]
        elif arg.startswith("--session="):
            result["session"] = arg.split("=", 1)[1]
        elif arg == "--session" and i + 1 < len(argv):
            i += 1
            result["session"] = argv[i]
        elif arg.startswith("--resume="):
            result["resume"] = arg.split("=", 1)[1]
        elif arg == "--resume" and i + 1 < len(argv):
            i += 1
            result["resume"] = argv[i]
        elif arg.startswith("--attachment="):
            result["attachments"].append(arg.split("=", 1)[1])
        elif arg == "--attachment" and i + 1 < len(argv):
            i += 1
            result["attachments"].append(argv[i])
        i += 1
    return result
