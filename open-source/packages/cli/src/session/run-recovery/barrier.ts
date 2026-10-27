// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/run-recovery-barrier.test.ts

export class RunRecoveryBarrier {
  private recovering = new Map<string, Promise<void>>()
  private releases = new Map<string, () => void>()
  private dispatchFrozen = false

  freezeDispatch(): void {
    this.dispatchFrozen = true
  }

  unfreezeDispatch(): void {
    this.dispatchFrozen = false
  }

  isDispatchFrozen(): boolean {
    return this.dispatchFrozen
  }

  begin(sessionId: string): void {
    if (this.recovering.has(sessionId)) return
    let release!: () => void
    const promise = new Promise<void>((resolve) => { release = resolve })
    this.recovering.set(sessionId, promise)
    this.releases.set(sessionId, release)
  }

  end(sessionId: string): void {
    this.releases.get(sessionId)?.()
    this.releases.delete(sessionId)
    this.recovering.delete(sessionId)
  }

  isRecovering(sessionId: string): boolean {
    return this.recovering.has(sessionId)
  }

  async wait(sessionId: string): Promise<void> {
    await this.recovering.get(sessionId)
  }
}
