// @arch docs/architecture/compatibility.md
// @test packages/app/src/__tests__/dir-browser-entries.test.ts

import {
  canGoUp,
  getParentDirectoryPath,
} from './directoryNavigation'

export type DirBrowserMode = 'session' | 'workDirPicker'

export function buildDirBrowserLsParams(
  mode: DirBrowserMode,
  pathToLoad: string,
  initialPath: string,
): { path: string; rootPath?: string } {
  void mode
  void initialPath
  return { path: pathToLoad }
}

export function canNavigateUpForDirBrowser(
  mode: DirBrowserMode,
  currentPath: string,
  initialPath: string,
): boolean {
  void mode
  void initialPath
  return canGoUp(currentPath)
}

export function getParentForDirBrowser(
  mode: DirBrowserMode,
  currentPath: string,
  initialPath: string,
): string {
  void mode
  void initialPath
  return getParentDirectoryPath(currentPath)
}
