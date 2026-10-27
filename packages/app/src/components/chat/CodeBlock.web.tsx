import { useState, useEffect, useCallback } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { codeToHtml } from 'shiki'

function isDarkDocument(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
  )
}

function useDocumentDark(): boolean {
  const [dark, setDark] = useState(isDarkDocument)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const el = document.documentElement
    const sync = () => setDark(el.classList.contains('dark'))
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return dark
}

export function CodeBlock({
  children,
  language,
}: {
  children: string
  language?: string
}) {
  const dark = useDocumentDark()
  const theme = dark ? 'github-dark' : 'github-light'
  const lang = language ?? 'text'
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml(null)

    const run = async () => {
      try {
        const out = await codeToHtml(children, { lang, theme })
        if (!cancelled) setHtml(out)
      } catch {
        try {
          const out = await codeToHtml(children, { lang: 'text', theme })
          if (!cancelled) setHtml(out)
        } catch {
          if (!cancelled) setHtml(null)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [children, lang, theme])

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
    })
  }, [children])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {lang !== 'text' && <Text style={styles.lang}>{lang}</Text>}
        <Pressable onPress={handleCopy} style={styles.copyBtn}>
          <Text style={styles.copyText}>{copied ? '✓ Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      {html == null ? (
        <View style={styles.codeWrap}>
          <Text style={styles.code} selectable>
            {children}
          </Text>
        </View>
      ) : (
        <div
          style={{
            overflow: 'auto',
            borderBottomLeftRadius: 8,
            borderBottomRightRadius: 8,
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </View>
  )
}

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
  codeWrap: {
    padding: 12,
  },
  code: {
    fontSize: 12,
    lineHeight: 18,
    color: '#1f2937',
  },
})
