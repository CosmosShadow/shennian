export function shouldSendOnEnter(event: {
  key: string; shiftKey: boolean; isComposing: boolean; keyCode: number
}): boolean {
  // Safari may clear isComposing before the Enter used to confirm an IME candidate.
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229
}
