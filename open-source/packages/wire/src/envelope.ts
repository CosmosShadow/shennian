export type Envelope = {
  id: string
  sessionId: string
  role: 'user' | 'agent'
  ts: number
  payload: string
}
