// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
export class HoldToSpeak {
  private current: { held: boolean; started: Promise<boolean> } | null = null
  constructor(
    private actions: {
      start: (held: () => boolean) => Promise<boolean>
      send: () => Promise<unknown>
      cancel: () => unknown
    },
  ) {}
  get active() {
    return this.current !== null
  }
  start() {
    if (this.current) return
    const current = { held: true, started: Promise.resolve(false) }
    this.current = current
    current.started = Promise.resolve()
      .then(() => this.actions.start(() => current.held && this.current === current))
      .catch(() => false)
  }
  async release(cancel = false) {
    const current = this.current
    if (!current) return
    current.held = false
    if (cancel) {
      this.current = null
      this.actions.cancel()
      return
    }
    const started = await current.started
    if (this.current !== current) return
    this.current = null
    if (started) await this.actions.send()
  }
  dispose() {
    void this.release(true)
  }
}
