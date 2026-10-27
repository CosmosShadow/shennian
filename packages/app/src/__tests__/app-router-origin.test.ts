// @covers packages/app/app.json

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Expo Router native origin', () => {
  it('keeps Head rendering usable in the native development and production bundles', () => {
    const config = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '../../app.json'), 'utf8'),
    ) as { expo?: { plugins?: unknown[] } }
    const routerPlugin = config.expo?.plugins?.find((plugin) => (
      Array.isArray(plugin) && plugin[0] === 'expo-router'
    ))

    expect(routerPlugin).toEqual([
      'expo-router',
      { origin: 'https://app.shennian.net' },
    ])
  })
})
