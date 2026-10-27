import { useState, useMemo } from 'react'
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'

function isSystemContextText(value: string): boolean {
  const text = value.trim()
  return (
    /^<environment_context>[\s\S]*<\/environment_context>$/i.test(text) ||
    /^# AGENTS\.md instructions for [^\n]+[\s\S]*<INSTRUCTIONS>[\s\S]*<\/INSTRUCTIONS>/i.test(text) ||
    /^<turn_aborted>[\s\S]*<\/turn_aborted>$/i.test(text)
  )
}

function sanitizeToolDisplayValue(value: unknown): unknown {
  if (typeof value === 'string') return isSystemContextText(value) ? '[SYSTEM CONTEXT REDACTED]' : value
  if (Array.isArray(value)) return value.map(sanitizeToolDisplayValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, raw]) => [
        key,
        sanitizeToolDisplayValue(raw),
      ]),
    )
  }
  return value
}

function toolDisplayText(value: unknown): string {
  if (typeof value === 'string') return isSystemContextText(value) ? '[SYSTEM CONTEXT REDACTED]' : value
  return JSON.stringify(sanitizeToolDisplayValue(value), null, 2)
}

export function ToolCallBlock({
  name,
  args,
  result,
  status,
  resultOmitted,
  command,
  argsSummary,
  detailStatus,
}: {
  name: string
  args?: unknown
  result?: string
  status?: string
  resultOmitted?: boolean
  command?: string
  argsSummary?: unknown
  detailStatus?: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const isRunning = status === 'running'
  const hasDetail = args != null || argsSummary != null || !!command

  const ds = useMemo(() => ({
    container: { borderColor: colors.border, backgroundColor: colors.surface },
    arrow: { color: colors.textSecondary },
    name: { color: colors.textSecondary },
    done: { color: colors.success },
    body: { borderTopColor: colors.border },
    sectionLabel: { color: colors.textTertiary },
    code: { backgroundColor: colors.surfaceHover, color: colors.text },
  }), [colors])

  return (
    <View style={[styles.container, ds.container]}>
      <Pressable style={styles.header} onPress={() => setExpanded((v) => !v)}>
        <Text style={[styles.arrow, ds.arrow]}>{expanded ? '▾' : '▸'}</Text>
        <Text style={[styles.name, ds.name]} numberOfLines={1}>
          🔧 {name}
        </Text>
        {isRunning ? <Text style={[styles.running, ds.arrow]}>•••</Text> : null}
        {!isRunning && (result != null || resultOmitted) ? <Text style={[styles.done, ds.done]}>✓</Text> : null}
      </Pressable>
      {expanded && (
        <View style={[styles.body, ds.body]}>
          {command ? (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, ds.sectionLabel]}>{t('command')}</Text>
              <Text style={[styles.code, ds.code]} selectable>
                {toolDisplayText(command)}
              </Text>
            </View>
          ) : null}
          {args != null && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, ds.sectionLabel]}>{t('arguments')}</Text>
              <Text style={[styles.code, ds.code]} selectable>
                {toolDisplayText(args)}
              </Text>
            </View>
          )}
          {args == null && argsSummary != null && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, ds.sectionLabel]}>{t('arguments')}</Text>
              <Text style={[styles.code, ds.code]} selectable>
                {toolDisplayText(argsSummary)}
              </Text>
            </View>
          )}
          {result != null && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, ds.sectionLabel]}>{t('result')}</Text>
              <Text style={[styles.code, ds.code]} selectable>
                {toolDisplayText(result)}
              </Text>
            </View>
          )}
          {resultOmitted && result == null ? (
            <Text style={[styles.hint, ds.sectionLabel]}>{t('tool_result_omitted')}</Text>
          ) : null}
          {!hasDetail ? (
            <Text style={[styles.hint, ds.sectionLabel]}>
              {detailStatus === 'loading'
                ? t('tool_detail_loading')
                : detailStatus === 'offline'
                  ? t('tool_detail_offline')
                  : detailStatus === 'unsupported'
                    ? t('tool_detail_unsupported')
                    : detailStatus === 'unavailable'
                      ? t('tool_detail_unavailable')
                      : detailStatus === 'error'
                        ? t('tool_detail_error')
                        : t('tool_detail_cta')}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  )
}

const monoFamily = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

const styles = StyleSheet.create({
  container: {
    marginBottom: 6,
    borderWidth: 1,
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
  name: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  done: {
    fontSize: 12,
  },
  running: {
    fontSize: 12,
    letterSpacing: 1,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  section: {
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  code: {
    fontSize: 11,
    fontFamily: monoFamily,
    borderRadius: 6,
    padding: 8,
  },
  hint: {
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 6,
  },
})
