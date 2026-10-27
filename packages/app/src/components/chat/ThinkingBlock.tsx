import { useState, useMemo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'

export function ThinkingBlock({ content }: { content: string }) {
  const { t } = useTranslation()
  const { isDark } = useTheme()
  const [expanded, setExpanded] = useState(false)

  const ds = useMemo(() => ({
    container: {
      borderLeftColor: isDark ? '#7c3aed' : '#a78bfa',
      backgroundColor: isDark ? '#2e1065' : '#faf5ff',
    },
    arrow: { color: '#7c3aed' },
    label: { color: '#7c3aed' },
    text: { color: isDark ? '#c4b5fd' : '#8b5cf6' },
  }), [isDark])

  return (
    <View style={[styles.container, ds.container]}>
      <Pressable style={styles.header} onPress={() => setExpanded((v) => !v)}>
        <Text style={[styles.arrow, ds.arrow]}>{expanded ? '▾' : '▸'}</Text>
        <Text style={[styles.label, ds.label]}>{t('thinking')}</Text>
      </Pressable>
      {expanded && (
        <View style={styles.body}>
          <Text style={[styles.text, ds.text]} selectable>
            {content}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 6,
    borderLeftWidth: 2,
    borderRadius: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  arrow: {
    fontSize: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  text: {
    fontSize: 12,
    lineHeight: 18,
  },
})
