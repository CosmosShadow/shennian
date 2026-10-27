// @arch docs/architecture/app/render-resilience.md
// @test src/__tests__/render-resilience.test.ts
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children?: ReactNode
  resetKey?: string
  resetToken?: unknown
  fallback: (retry: () => void) => ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
}
type State = { failed: boolean; resetKey?: string; resetToken?: unknown }

/** Last line of defence for render/lifecycle failures. Does not swallow event or async errors. */
export class RenderErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey, resetToken: this.props.resetToken }
  static getDerivedStateFromError(): Partial<State> { return { failed: true } }
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey || props.resetToken !== state.resetToken
      ? { failed: false, resetKey: props.resetKey, resetToken: props.resetToken } : null
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local-only frame positions: never log message, paths, params or content.
    try {
      const positions = error.stack?.split('\n').slice(1).join('\n').match(/:\d+:\d+/g)?.slice(0, 4)
      if (positions?.length) console.warn('[render-failure-positions]', positions.join(','))
    } catch { /* diagnostics must not break recovery */ }
    // Diagnostics must never turn a local rendering failure into a root failure.
    try { this.props.onError?.(error, info) } catch { /* keep recovery controls mounted */ }
  }
  retry = () => this.setState({ failed: false })
  render() { return this.state.failed ? this.props.fallback(this.retry) : this.props.children }
}
