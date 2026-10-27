from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Event:
    state: str
    run_id: str | None = field(default=None, repr=False)
    seq: int | None = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        for k, v in asdict(self).items():
            if v is None:
                continue
            key = _to_camel(k)
            d[key] = v
        return d


@dataclass
class DeltaEvent(Event):
    state: str = field(default="delta", init=False)
    text: str = ""
    thinking: bool | None = None


@dataclass
class FinalEvent(Event):
    state: str = field(default="final", init=False)
    usage: dict[str, int] | None = None


@dataclass
class ErrorEvent(Event):
    state: str = field(default="error", init=False)
    message: str = ""


@dataclass
class ToolCallEvent(Event):
    state: str = field(default="tool-call", init=False)
    name: str = ""
    args: dict[str, Any] | None = None


@dataclass
class ToolResultEvent(Event):
    state: str = field(default="tool-result", init=False)
    name: str = ""
    result: str = ""


@dataclass
class NotifyEvent(Event):
    state: str = field(default="notify", init=False)
    text: str = ""
    title: str | None = None
    source: str | None = None


def serialize(event: Event) -> str:
    return json.dumps(event.to_dict(), ensure_ascii=False)


def _to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])
