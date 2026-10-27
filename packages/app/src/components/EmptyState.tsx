import { ActionIcon } from './ActionIcon'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useMachinesStore, useSheetsStore } from '@shennian/shared'
import { useTheme } from '../hooks/useTheme'

export function EmptyState() {
  const { t } = useTranslation()
  const openMachinePicker = useSheetsStore((s) => s.openMachinePicker)
  const openAddMachine = useSheetsStore((s) => s.openAddMachine)
  const hasMachines = useMachinesStore((s) => s.machines.length > 0)
  const { colors } = useTheme()

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.iconCircle, { backgroundColor: colors.brand + '10' }]}>
        <Ionicons name="chatbubbles-outline" size={28} color={colors.brand} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>
        {t(hasMachines ? 'select_or_create' : 'no_machines')}
      </Text>
      <Pressable
        style={[styles.btn, { backgroundColor: colors.brand }]}
        onPress={hasMachines ? openMachinePicker : openAddMachine}
      >
        <View style={styles.btnInner}>
          <ActionIcon name="add" color="#fff" />
          <Text style={styles.btnText}>
            {t(hasMachines ? 'start_new_project' : 'add_machine_short')}
          </Text>
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  iconText: {},
  title: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  btn: {
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  btnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})
