// @covers src/features/personal-modules/PersonalEnglishScreen.tsx
// @vitest-environment happy-dom
import './english-screen.fixture'
import { expect, it } from 'vitest'
import { shouldShowStewardDock, stewardPageContext } from '../features/steward/contextualSteward'
it('keeps the English vocabulary entry free of the global chat composer', () => {
  expect(shouldShowStewardDock(stewardPageContext('personal-modules', { tab: 'english' }))).toBe(
    false,
  )
  expect(shouldShowStewardDock(stewardPageContext('personal-modules', { tab: 'reminders' }))).toBe(
    true,
  )
})
