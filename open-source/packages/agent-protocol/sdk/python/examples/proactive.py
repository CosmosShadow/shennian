#!/usr/bin/env python3
"""Proactive monitoring agent using stdio mode.

Sends periodic notify events while also responding to user messages.
"""
from __future__ import annotations

import random
import threading
import time

from shennian_agent import Agent

agent = Agent(name="Monitor Agent", model="monitor", mode="stdio", proactive=True)


def background_monitor() -> None:
    while True:
        time.sleep(10)
        cpu = random.randint(20, 95)
        if cpu > 80:
            agent.notify(
                text=f"CPU usage is at {cpu}%",
                title="High CPU Alert",
                source="monitor:cpu",
            )


@agent.on_send
def handle(text: str, session_id: str | None, attachments: list) -> None:
    agent.delta(f"Monitoring active. You said: {text}")
    agent.final()


if __name__ == "__main__":
    threading.Thread(target=background_monitor, daemon=True).start()
    agent.run()
