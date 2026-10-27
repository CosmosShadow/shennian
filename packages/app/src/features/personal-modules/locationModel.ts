// @arch docs/features/recording-location.md
// @test src/__tests__/recording-location.test.ts
export type RoutePoint = {
  session: string
  timestamp: number
  latitude: number
  longitude: number
  accuracy: number
  speed: number | null
  day: string
}
export function locationDay(timestamp: number) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function validPoint(p: RoutePoint, now = Date.now()) {
  return (
    Number.isFinite(p.timestamp) &&
    p.timestamp > 0 &&
    p.timestamp <= now + 60000 &&
    Number.isFinite(p.latitude) &&
    Math.abs(p.latitude) <= 90 &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.longitude) <= 180 &&
    Number.isFinite(p.accuracy) &&
    p.accuracy >= 0 &&
    p.accuracy <= 100 &&
    (p.speed === null || (Number.isFinite(p.speed) && p.speed >= 0))
  )
}
export function distanceMetres(a: RoutePoint, b: RoutePoint) {
  const r = Math.PI / 180
  const v =
    Math.sin(((b.latitude - a.latitude) * r) / 2) ** 2 +
    Math.cos(a.latitude * r) *
      Math.cos(b.latitude * r) *
      Math.sin(((b.longitude - a.longitude) * r) / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, v)), Math.sqrt(Math.max(0, 1 - v)))
}
/** Never bridge sessions, >5 minute gaps, GPS jitter or physically implausible jumps. */
export function routeSummary(input: RoutePoint[]) {
  const points = input.filter((p) => validPoint(p)).sort((a, b) => a.timestamp - b.timestamp)
  let metres = 0
  const stops: { point: RoutePoint; end: number }[] = []
  let anchor: RoutePoint | undefined, last: RoutePoint | undefined
  const finish = () => {
    if (anchor && last && last.timestamp - anchor.timestamp >= 300000)
      stops.push({ point: anchor, end: last.timestamp })
  }
  for (const p of points) {
    const dt = last ? (p.timestamp - last.timestamp) / 1000 : 0
    const connected = last && p.session === last.session && dt > 0 && dt <= 300
    if (connected) {
      const d = distanceMetres(last!, p)
      if (d > Math.max(10, (p.accuracy + last!.accuracy) / 2) && d / dt <= 70) metres += d
    }
    if (!connected || !anchor || distanceMetres(anchor, p) > 100) {
      finish()
      anchor = p
    }
    last = p
  }
  finish()
  return { points, metres, stops }
}
