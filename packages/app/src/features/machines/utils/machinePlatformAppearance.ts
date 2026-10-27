// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-detail-source.test.ts

export function machinePlatformAppearance(os: string, isDark: boolean) {
  if (/darwin|mac|os x/i.test(os)) {
    return { icon: 'logo-apple' as const, color: '#7856D8', background: isDark ? '#35264F' : '#F0EAFE' }
  }
  if (/windows|win32/i.test(os)) {
    return { icon: 'logo-windows' as const, color: '#1686D9', background: isDark ? '#17374F' : '#E7F4FD' }
  }
  if (/linux/i.test(os)) {
    return { icon: 'logo-tux' as const, color: '#D97832', background: isDark ? '#4A301E' : '#FFF0E4' }
  }
  return { icon: 'desktop-outline' as const, color: isDark ? '#A3A3A3' : '#666666', background: isDark ? '#262626' : '#F5F5F5' }
}
