// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
// Port of Aido RecordingGate: energy segmentation, not speaker/speech recognition.
export type GateEvent =
  | { type: 'open'; startAt: number; frames: Uint8Array[] }
  | { type: 'audio'; frame: Uint8Array }
  | { type: 'end' }
export class EnergyGate {
  private pre: Uint8Array[] = []
  private preSeconds = 0
  private loud = 0
  private quiet = 0
  private duration = 0
  active = false
  consume(frame: Uint8Array, now: number): GateEvent[] {
    if (!frame.byteLength || frame.byteLength % 2) return []
    const seconds = frame.byteLength / 32000
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    let total = 0
    for (let i = 0; i < frame.byteLength; i += 2) total += (view.getInt16(i, true) / 32768) ** 2
    const rms = Math.sqrt(total / (frame.byteLength / 2))
    if (this.active) {
      this.duration += seconds
      this.quiet = rms < 0.008 ? this.quiet + seconds : 0
      const events: GateEvent[] = [{ type: 'audio', frame }]
      if (this.quiet >= 1.6 || this.duration >= 50) {
        this.reset()
        events.push({ type: 'end' })
      }
      return events
    }
    this.pre.push(frame.slice())
    this.preSeconds += seconds
    while (this.preSeconds > 0.8 && this.pre.length > 1)
      this.preSeconds -= this.pre.shift()!.byteLength / 32000
    this.loud = rms >= 0.012 ? this.loud + seconds : 0
    if (this.loud < 0.06) return []
    this.active = true
    this.duration = this.preSeconds
    this.quiet = 0
    const event: GateEvent = {
      type: 'open',
      startAt: now - this.preSeconds * 1000,
      frames: this.pre,
    }
    this.pre = []
    this.preSeconds = 0
    return [event]
  }
  reset() {
    this.active = false
    this.pre = []
    this.preSeconds = 0
    this.loud = 0
    this.quiet = 0
    this.duration = 0
  }
}
