// @arch docs/features/personal-agent-workspace.md
// @test packages/app/src/__tests__/memory-folder.test.ts
import { useLocalSearchParams } from 'expo-router'
import DiaryScreen from './DiaryScreen'
import MemoryFolderScreen from './MemoryFolderScreen'

export default function PersonalWorkspaceScreen() {
  const { kind } = useLocalSearchParams<{ kind: string }>()
  return kind === 'diary' ? <DiaryScreen /> : <MemoryFolderScreen />
}
