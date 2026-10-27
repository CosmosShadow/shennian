// @arch docs/design/desktop/macos-interaction-baseline.md
import { useTheme } from '../../hooks/useTheme'

/** Desktop switch with a real keyboard/AT checkbox, independent of RN Web thumb tinting. */
export function DesktopSwitch({ value, onValueChange, disabled, accessibilityLabel, testID }: {
  value: boolean; onValueChange(value: boolean): void; disabled?: boolean; accessibilityLabel: string; testID?: string
}) {
  const { isDark } = useTheme()
  return <label style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
    <input type="checkbox" role="switch" aria-label={accessibilityLabel} checked={value} disabled={disabled}
      data-testid={testID} onChange={event => onValueChange(event.target.checked)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'inherit' }} />
    <span aria-hidden="true" style={{ display: 'block', width: 36, height: 22, borderRadius: 12, background: value ? '#248a3d' : isDark ? '#81868e' : '#7c828a', pointerEvents: 'none' }}>
      <span style={{ display: 'block', width: 18, height: 18, margin: 2, borderRadius: '50%', background: '#fff', transform: `translateX(${value ? 14 : 0}px)` }} />
    </span>
    <style>{'input[role="switch"]:focus-visible + span { outline: 2px solid Highlight; outline-offset: 3px; }'}</style>
  </label>
}
