// @arch docs/architecture/app/modular-features.md
// @test src/__tests__/server-config.test.ts

import { StyleSheet } from 'react-native'
import { contentStyles } from './landingThemeContent'
import { heroStyles } from './landingThemeHero'
export { C, webGlass } from './landingThemeTokens'

export const s = StyleSheet.create({
  ...heroStyles,
  ...contentStyles,
})
