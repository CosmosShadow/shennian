// @arch docs/features/builtin-personal-agent.md
// @test src/__tests__/steward-model.test.ts
import { Redirect } from 'expo-router'
/** Legacy deep links no longer expose a personal session manager. History is retained in the timeline. */
export function StewardSessionsScreen() { return <Redirect href="/(main)/steward-settings" /> }
