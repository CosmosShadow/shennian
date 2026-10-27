// @arch docs/architecture/app/chat-voice-draft.md
// @test src/__tests__/interactive-content-session.test.ts
/** A released hold may not start listening later after an async permission prompt. */
export function createHoldToTalk(io: {
  available(): boolean; start(continueHolding: () => boolean): Promise<boolean>
  stop(): void; cancel(): void; focus(): void
  feedback?(phase: 'idle' | 'preparing' | 'listening', cancelling: boolean): void
}) {
  let held = false, ready = false, consumed = false, disposed = false, pending = false, cancelling = false
  return {
    arm() { if (!pending) consumed = false },
    start() {
      if (disposed || pending || !io.available()) return
      consumed = true; held = true; ready = false; pending = true; cancelling = false
      io.feedback?.('preparing', false)
      void io.start(() => held && !disposed).then((started) => {
        pending = false
        if (!held || disposed) { if (started) io.cancel(); return }
        ready = started
        io.feedback?.(started ? 'listening' : 'idle', cancelling)
      }, () => { pending = false; ready = false; if (!disposed) io.feedback?.('idle', false) })
    },
    move(dy: number) { if (held) { cancelling = dy < -48; io.feedback?.(ready ? 'listening' : 'preparing', cancelling) } },
    cancel() { if (held || pending) io.cancel(); held = false; ready = false; consumed = true; io.feedback?.('idle', false) },
    release() {
      if (!held) return
      held = false
      if (ready && !cancelling) io.stop(); else io.cancel()
      ready = false; io.feedback?.('idle', false)
    },
    tap() { if (!consumed && !disposed) io.focus() },
    dispose() { disposed = true; if (held || pending) io.cancel(); held = false; ready = false },
  }
}
