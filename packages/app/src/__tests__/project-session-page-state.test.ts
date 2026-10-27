// @covers src/features/projects/services/projectSessionPageState.ts

import { describe, expect, it } from 'vitest'
import {
  classifyProjectSessionPageFailure,
  resolveProjectSessionPageSurfaceState,
} from '../features/projects/services/projectSessionPageState'

describe('project session page state', () => {
  it('keeps cached conversations visible during refresh and offline failures', () => {
    expect(resolveProjectSessionPageSurfaceState({
      projectAvailable: true,
      sessionCount: 2,
      localIndexLoading: false,
      pageLoading: true,
      remoteAttempted: true,
      failure: null,
    })).toBe('ready')
    expect(resolveProjectSessionPageSurfaceState({
      projectAvailable: true,
      sessionCount: 2,
      localIndexLoading: false,
      pageLoading: false,
      remoteAttempted: true,
      failure: 'offline',
    })).toBe('offline')
  })

  it('does not mistake first load, an empty project, and revoked access', () => {
    const base = { projectAvailable: true, sessionCount: 0, localIndexLoading: false }
    expect(resolveProjectSessionPageSurfaceState({
      ...base, pageLoading: true, remoteAttempted: true, failure: null,
    })).toBe('pending')
    expect(resolveProjectSessionPageSurfaceState({
      ...base, pageLoading: false, remoteAttempted: true, failure: null,
    })).toBe('empty')
    expect(resolveProjectSessionPageSurfaceState({
      ...base, pageLoading: false, remoteAttempted: true, failure: 'forbidden',
    })).toBe('forbidden')
  })

  it('renders cached rows immediately before a request and during local restore or pagination', () => {
    for (const localIndexLoading of [false, true]) {
      for (const pageLoading of [false, true]) {
        for (const remoteAttempted of [false, true]) {
          expect(resolveProjectSessionPageSurfaceState({
            projectAvailable: true, sessionCount: 2,
            localIndexLoading, pageLoading, remoteAttempted, failure: null,
          })).toBe('ready')
        }
      }
    }
  })

  it('does not flash an empty project before local restore or the first page', () => {
    const base = { projectAvailable: true, sessionCount: 0, localIndexLoading: false, failure: null }
    expect(resolveProjectSessionPageSurfaceState({
      ...base, pageLoading: false, remoteAttempted: false,
    })).toBe('pending')
    expect(resolveProjectSessionPageSurfaceState({
      ...base, localIndexLoading: true, pageLoading: false, remoteAttempted: true,
    })).toBe('pending')
  })

  it('retains error and authority boundaries without replacing readable cached rows on refresh', () => {
    const base = {
      projectAvailable: true, sessionCount: 2, localIndexLoading: false,
      pageLoading: false, remoteAttempted: true,
    }
    expect(resolveProjectSessionPageSurfaceState({ ...base, failure: 'error' })).toBe('error')
    expect(resolveProjectSessionPageSurfaceState({ ...base, failure: 'forbidden' })).toBe('forbidden')
    expect(resolveProjectSessionPageSurfaceState({
      ...base, projectAvailable: false, sessionCount: 0, failure: null,
    })).toBe('forbidden')
  })

  it('prioritizes explicit authority loss over connectivity heuristics', () => {
    expect(classifyProjectSessionPageFailure({ status: 403 }, 'disconnected')).toBe('forbidden')
    expect(classifyProjectSessionPageFailure({ status: 404 }, 'connected')).toBe('forbidden')
    expect(classifyProjectSessionPageFailure(new Error('network'), 'disconnected')).toBe('offline')
    expect(classifyProjectSessionPageFailure(new Error('server'), 'connected')).toBe('error')
  })
})
