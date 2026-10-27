#!/usr/bin/env python3
"""Minimal echo agent using spawn mode."""
from __future__ import annotations

from shennian_agent import Agent

agent = Agent(name="Echo Agent", model="echo", mode="spawn", resume=True)


@agent.on_resume
def resume(session_id: str, agent_session_id: str) -> None:
    """Restore durable provider state before the recovery input is delivered."""
    if not agent_session_id:
        raise ValueError("missing session id")


@agent.on_send
def handle(text: str, session_id: str | None, attachments: list) -> None:
    agent.delta(f"You said: {text}")
    agent.final()


if __name__ == "__main__":
    agent.run()
