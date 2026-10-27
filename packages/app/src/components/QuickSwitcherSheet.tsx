import { useVisibleProjectRecords } from '../features/projects/hooks/useVisibleProjectRecords'
// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/keyboard-shortcuts.test.ts

import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  filterProjectSessions,
  getProjectDisplayName,
  groupSessionsIntoProjects,
  sortProjects,
  useMachinesStore,
  useSessionsStore,
  useSheetsStore,
} from '@shennian/shared'
import BottomSheet from './BottomSheet'
import { useTheme } from '../hooks/useTheme'

type Props = {
  visible: boolean
  onClose: () => void
}

type Result =
  | { kind: 'session'; id: string; title: string; subtitle: string }
  | { kind: 'project'; machineId: string; workDir: string; title: string; subtitle: string }
  | { kind: 'machine'; id: string; title: string; subtitle: string }

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

export function QuickSwitcherSheet({ visible, onClose }: Props) {
  const router = useRouter()
  const { colors } = useTheme()
  const sessions = useSessionsStore((store) => store.sessions)
  const machines = useMachinesStore((store) => store.machines)
  const projectRecords = useVisibleProjectRecords()
  const openMachinePicker = useSheetsStore((store) => store.openMachinePicker)
  const inputRef = useRef<TextInput>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!visible) {
      setQuery('')
      return
    }
    if (Platform.OS !== 'web') return
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [visible])

  const results = useMemo(() => {
    const machineNames = new Map(machines.map((machine) => [machine.id, machine.name]))
    const projectSessions = filterProjectSessions(sessions)
    const projects = sortProjects(groupSessionsIntoProjects(projectSessions, projectRecords))
    const allResults: Result[] = [
      ...projectSessions.slice(0, 30).map((session) => ({
        kind: 'session' as const,
        id: session.id,
        title: session.title || 'Untitled conversation',
        subtitle: [machineNames.get(session.machineId) ?? session.machineName, session.workDir]
          .filter(Boolean)
          .join(' · '),
      })),
      ...projects.slice(0, 20).map((project) => ({
        kind: 'project' as const,
        machineId: project.machineId,
        workDir: project.workDir,
        title: getProjectDisplayName(project),
        subtitle: project.machineName || machineNames.get(project.machineId) || 'Project',
      })),
      ...machines.slice(0, 20).map((machine) => ({
        kind: 'machine' as const,
        id: machine.id,
        title: machine.name,
        subtitle: machine.online ? 'Machine · Online' : 'Machine · Offline',
      })),
    ]
    const q = normalize(query)
    if (!q) return allResults.slice(0, 24)
    return allResults
      .filter((item) => normalize(`${item.title} ${item.subtitle}`).includes(q))
      .slice(0, 24)
  }, [machines, projectRecords, query, sessions])

  const handlePress = (item: Result) => {
    onClose()
    if (item.kind === 'session') {
      router.navigate(`/(main)/chat/${item.id}`)
      return
    }
    if (item.kind === 'project') {
      router.navigate({
        pathname: '/(main)/project',
        params: { machineId: item.machineId, workDir: item.workDir },
      })
      return
    }
    openMachinePicker()
  }

  return (
    <BottomSheet isOpen={visible} onClose={onClose} title="快速切换" preferDialogOnWeb avoidKeyboard={false}>
      <View style={styles.wrap}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
          value={query}
          onChangeText={setQuery}
          placeholder="搜索会话、项目、机器"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.results}>
          {results.map((item, index) => (
            <Pressable
              key={`${item.kind}-${item.kind === 'project' ? `${item.machineId}-${item.workDir}` : item.id}-${index}`}
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => handlePress(item)}
            >
              <Text style={[styles.kind, { color: colors.brand }]}>{item.kind}</Text>
              <View style={styles.rowBody}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>{item.subtitle}</Text>
              </View>
            </Pressable>
          ))}
          {results.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textTertiary }]}>没有匹配结果</Text>
          ) : null}
        </View>
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  results: { gap: 8 },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kind: { width: 54, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  rowBody: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '700' },
  subtitle: { marginTop: 2, fontSize: 12 },
  empty: { paddingVertical: 18, textAlign: 'center', fontSize: 13 },
})
