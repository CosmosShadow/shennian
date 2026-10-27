// @arch docs/features/recording-location.md
// @test src/__tests__/recording-location-ui.test.ts
import { useEffect, useState } from 'react'
import { AppState, Share, Pressable, Text, View } from 'react-native'
import Svg, { Polyline } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { locationStore } from './locationStore'
import { distanceMetres, routeSummary, type RoutePoint } from './locationModel'
import { useLocationTracking } from './locationTrackingState'
/** Split real recording gaps; this is a schematic, not a geographic base map. */
export function routeLines(points: RoutePoint[]) {
  const lines: RoutePoint[][] = []
  for (const p of points) {
    const line = lines[lines.length - 1],
      last = line?.[line.length - 1]
    const dt = last ? (p.timestamp - last.timestamp) / 1000 : 0
    if (
      !last ||
      last.session !== p.session ||
      dt <= 0 ||
      dt > 300 ||
      distanceMetres(last, p) / dt > 70
    )
      lines.push([p])
    else line.push(p)
  }
  return lines
}
export function RecordingRoute({ day }: { day: string }) {
  const { t } = useTranslation(),
    { colors } = useTheme()
  const account = useAuthStore((s) => s.user?.id)
  const revision = useLocationTracking((s) => s.revision)
  const [data, setData] = useState<{ account: string; day: string; points: RoutePoint[] } | null>(
    null,
  )
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!account) return
    let cancelled = false
    const load = async () => {
      try {
        const points = await locationStore.points(account, day)
        if (!cancelled && useAuthStore.getState().user?.id === account) {
          setData({ account, day, points })
          setError(false)
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }
    void load()
    const listener = AppState.addEventListener('change', (v) => {
      if (v === 'active') void load()
    })
    return () => {
      cancelled = true
      listener.remove()
    }
  }, [account, day, revision])
  const summary = routeSummary(
    data && data.account === account && data.day === day ? data.points : [],
  )
  if (error)
    return (
      <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
        {t('location_failed')}
      </Text>
    )
  if (!summary.points.length) return null
  const lat = summary.points.map((p) => p.latitude),
    lon = summary.points.map((p) => p.longitude)
  const minLat = Math.min(...lat),
    minLon = Math.min(...lon)
  const scaleX = Math.max(0.001, Math.cos((lat[0]! * Math.PI) / 180))
  const width = (Math.max(...lon) - minLon) * scaleX,
    height = Math.max(...lat) - minLat
  const scale = Math.min(280 / Math.max(width, 0.0001), 140 / Math.max(height, 0.0001))
  return (
    <View style={{ marginVertical: 16, gap: 10 }}>
      <Text style={{ ...mobileTypography.listTitle, color: colors.text }}>
        {t('location_route')}
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        {t('location_distance', {
          km: (summary.metres / 1000).toFixed(2),
          count: summary.points.length,
        })}
      </Text>
      <Svg
        width="100%"
        height={180}
        viewBox="0 0 320 180"
        accessibilityLabel={t('location_schematic')}
      >
        {routeLines(summary.points).map((line, index) => (
          <Polyline
            key={index}
            fill="none"
            stroke={colors.brand}
            strokeWidth={3}
            points={line
              .map(
                (p) =>
                  `${20 + (p.longitude - minLon) * scaleX * scale},${160 - (p.latitude - minLat) * scale}`,
              )
              .join(' ')}
          />
        ))}
      </Svg>
      <Text style={{ color: colors.textSecondary }}>{t('location_schematic')}</Text>
      {summary.stops.map((stop) => (
        <Text
          key={`${stop.point.session}:${stop.point.timestamp}`}
          selectable
          style={{ color: colors.text }}
        >
          {t('location_stop', {
            start: new Date(stop.point.timestamp).toLocaleTimeString(),
            end: new Date(stop.end).toLocaleTimeString(),
            minutes: Math.floor((stop.end - stop.point.timestamp) / 60000),
            lat: stop.point.latitude.toFixed(5),
            lon: stop.point.longitude.toFixed(5),
          })}
        </Text>
      ))}
      <Pressable
        accessibilityRole="button"
        style={{ minHeight: 44, justifyContent: 'center' }}
        onPress={() =>
          void Share.share({
            message: JSON.stringify({
              type: 'FeatureCollection',
              features: routeLines(summary.points).map((line) => ({
                type: 'Feature',
                properties: {
                  session: line[0]!.session,
                  timestamps: line.map((p) => new Date(p.timestamp).toISOString()),
                },
                geometry:
                  line.length === 1
                    ? { type: 'Point', coordinates: [line[0]!.longitude, line[0]!.latitude] }
                    : {
                        type: 'LineString',
                        coordinates: line.map((p) => [p.longitude, p.latitude]),
                      },
              })),
            }),
          }).catch(() => setError(true))
        }
      >
        <Text style={{ color: colors.brand }}>{t('location_export')}</Text>
      </Pressable>
    </View>
  )
}
