let _currentTraceId: string | null = null

export function generateTraceId(): string {
  let hex = ''
  for (let i = 0; i < 16; i++) {
    hex += ((Math.random() * 16) | 0).toString(16)
  }
  return hex
}

export function getCurrentTraceId(): string | null {
  return _currentTraceId
}

export function setCurrentTraceId(id: string | null): void {
  _currentTraceId = id
}
