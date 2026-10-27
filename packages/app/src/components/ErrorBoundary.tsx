import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import { reportLog } from '../config/log'

type Props = { children: ReactNode; fallback?: ReactNode }
type State = { hasError: boolean; error: Error | null; info: ErrorInfo | null; copied: boolean }

function formatErrorDiagnostics(error: Error | null, info: ErrorInfo | null): string {
  const shellVersion = Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? 'unknown'
  const deliveryVersion = `${Constants.expoConfig?.extra?.deliveryVersion ?? ''}`.trim() || 'unknown'
  const otaSuffix = `${Constants.expoConfig?.extra?.otaVersionSuffix ?? ''}`.trim() || 'unknown'
  const lines = [
    'Shennian crash diagnostics',
    `name: ${error?.name ?? 'Error'}`,
    `message: ${error?.message ?? 'Unknown error'}`,
    `shellVersion: ${shellVersion}`,
    `deliveryVersion: ${deliveryVersion}`,
    `otaSuffix: ${otaSuffix}`,
    '',
    'componentStack:',
    info?.componentStack?.trim() || '(empty)',
    '',
    'jsStack:',
    error?.stack || '(empty)',
  ]
  return lines.join('\n')
}

function firstStackLine(stack: string | undefined): string {
  return stack?.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null, copied: false }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info })
    console.error('[ErrorBoundary]', error, info.componentStack)
    reportLog({
      level: 'error',
      errorMessage: error.message,
      errorStack: error.stack,
      metadata: {
        name: error.name,
        componentStack: info.componentStack,
      },
    })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, info: null, copied: false })
  }

  handleCopy = () => {
    const diagnostics = formatErrorDiagnostics(this.state.error, this.state.info)
    void Clipboard.setStringAsync(diagnostics).then(() => this.setState({ copied: true })).catch(() => {})
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      const errorName = this.state.error?.name ?? 'Error'
      const errorMessage = this.state.error?.message ?? 'Unknown error'
      const topStackLine = firstStackLine(this.state.error?.stack)
      const componentStack = this.state.info?.componentStack?.trim()
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Root cause</Text>
            <Text style={styles.errorName}>{errorName}</Text>
            <Text selectable style={styles.message}>{errorMessage}</Text>
            {topStackLine ? <Text selectable style={styles.stackLine}>{topStackLine}</Text> : null}
          </View>
          {componentStack ? (
            <View style={styles.card}>
              <Text style={styles.label}>Where it happened</Text>
              <Text selectable style={styles.stackText} numberOfLines={8}>
                {componentStack}
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={this.handleCopy}>
              <Text style={styles.secondaryButtonText}>{this.state.copied ? 'Copied' : 'Copy details'}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={this.handleReset}>
              <Text style={styles.buttonText}>Try Again</Text>
            </Pressable>
          </View>
        </ScrollView>
      )
    }
    return this.props.children
  }
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  icon: { fontSize: 48, marginBottom: 16 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
    marginBottom: 16,
  },
  card: {
    width: '100%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    padding: 16,
    marginBottom: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  errorName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
    color: '#b91c1c',
    lineHeight: 20,
  },
  stackLine: {
    marginTop: 10,
    fontSize: 12,
    color: '#4b5563',
    lineHeight: 17,
    fontFamily: 'Courier',
  },
  stackText: {
    fontSize: 11,
    color: '#4b5563',
    lineHeight: 16,
    fontFamily: 'Courier',
  },
  actions: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  button: {
    flex: 1,
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderColor: '#d1d5db',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  secondaryButtonText: { color: '#374151', fontSize: 14, fontWeight: '600' },
})
