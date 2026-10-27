// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../src/__tests__/desktop-call-retirement.test.ts
import { Redirect } from 'expo-router'

/** Native route names do not grant a Desktop/browser calling capability. */
export default function RetiredVoiceRoute() { return <Redirect href="/" /> }
