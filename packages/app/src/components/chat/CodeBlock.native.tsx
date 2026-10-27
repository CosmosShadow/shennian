import { useState } from 'react'
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native'

export function CodeBlock({
  children,
  language,
}: {
  children: string
  language?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(children)
      }
    } catch {
      /* clipboard not available on native without extra deps */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {language ? <Text style={styles.lang}>{language}</Text> : null}
        <Pressable onPress={() => void handleCopy()} style={styles.copyBtn}>
          <Text style={styles.copyText}>{copied ? '✓' : 'Copy'}</Text>
        </Pressable>
      </View>
      <Text style={styles.code} selectable>
        {children}
      </Text>
    </View>
  )
}

const monoFamily = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f3f4f6',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  lang: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    fontFamily: monoFamily,
  },
  copyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#e5e7eb',
  },
  copyText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#374151',
  },
  code: {
    padding: 12,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: monoFamily,
    color: '#1f2937',
  },
})
