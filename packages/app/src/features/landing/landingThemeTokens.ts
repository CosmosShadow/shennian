// @arch docs/architecture/app/modular-features.md
// @test src/__tests__/server-config.test.ts

export const C = {
  brand: '#6366F1',
  brandDark: '#4F46E5',
  brandLight: 'rgba(99,102,241,0.08)',
  brandBorder: 'rgba(99,102,241,0.25)',

  bg: '#FBFAFF',
  white: '#FFFFFF',

  neutral50: '#FAFAFA',
  neutral100: '#F5F5F5',
  neutral200: '#E5E5E5',
  neutral300: '#D4D4D4',
  neutral400: '#A3A3A3',
  neutral500: '#737373',
  neutral600: '#525252',
  neutral700: '#404040',
  neutral800: '#262626',
  neutral900: '#171717',
  neutral950: '#0A0A0A',

  indigo50: '#EEF2FF',
  indigo600: '#4F46E5',
  teal50: '#F0FDFA',
  teal600: '#0D9488',
  green50: '#F0FDF4',
  green600: '#16A34A',
  green400: '#4ADE80',
  orange50: '#FFF7ED',
  orange500: '#F97316',
  sky50: '#F0F9FF',
  sky500: '#0EA5E9',
  purple50: '#FAF5FF',
  purple500: '#A855F7',
  pink50: '#FDF2F8',
  pink500: '#EC4899',
  red400: '#F87171',
  yellow400: '#FACC15',
  blue400: '#60A5FA',
} as const

// Web-only styles applied via `as any` casts in components.
export const webGlass = {
  backdropFilter: 'saturate(180%) blur(20px)',
  WebkitBackdropFilter: 'saturate(180%) blur(20px)',
}

