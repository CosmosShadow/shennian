// @covers src/features/personal-modules/locationModel.ts
import { describe, expect, it } from 'vitest'
import {
  distanceMetres,
  locationDay,
  routeSummary,
  validPoint,
  type RoutePoint,
} from '../features/personal-modules/locationModel'
const at = Date.now() - 3600000
function point(offset: number, longitude = 120, session = 'a'): RoutePoint {
  return {
    session,
    timestamp: at + offset,
    latitude: 30,
    longitude,
    accuracy: 5,
    speed: null,
    day: locationDay(at),
  }
}
describe('recorded route estimates', () => {
  it('rejects invalid, future, inaccurate and impossible coordinates', () => {
    expect(validPoint(point(0))).toBe(true)
    for (const patch of [
      { latitude: NaN },
      { latitude: 91 },
      { longitude: 181 },
      { accuracy: -1 },
      { accuracy: 101 },
      { timestamp: Date.now() + 120000 },
      { speed: -1 },
    ])
      expect(validPoint({ ...point(0), ...patch })).toBe(false)
  })
  it('measures a real geodesic and suppresses stationary jitter', () => {
    expect(distanceMetres(point(0), point(30000, 120.001))).toBeCloseTo(96.3, 0)
    expect(routeSummary([point(0), point(30000, 120.001)]).metres).toBeGreaterThan(90)
    expect(routeSummary([point(0), point(30000, 120.00001)]).metres).toBe(0)
  })
  it('does not bridge recording sessions, long gaps or teleportation', () => {
    expect(routeSummary([point(0), point(30000, 120.001, 'b')]).metres).toBe(0)
    expect(routeSummary([point(0), point(600000, 120.001)]).metres).toBe(0)
    expect(routeSummary([point(0), point(1000, 121)]).metres).toBe(0)
  })
  it('only reports stops with five minutes of continuous observed evidence', () => {
    const rows = Array.from({ length: 7 }, (_, i) => point(i * 60000, 120 + (i % 2) * 0.00001))
    const result = routeSummary(rows.reverse())
    expect(result.stops).toHaveLength(1)
    expect(result.stops[0]!.end - result.stops[0]!.point.timestamp).toBe(360000)
    expect(routeSummary([point(0), point(600000)]).stops).toEqual([])
  })
  it('keeps empty days empty and derives the capture-local date', () => {
    expect(routeSummary([])).toEqual({ points: [], metres: 0, stops: [] })
    expect(locationDay(new Date(2026, 9, 24, 23, 59).getTime())).toBe('2026-10-24')
  })
})
