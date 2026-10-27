// @arch docs/design/foundations.md#5-图标
// @test src/__tests__/app-page-header.test.ts

import Svg, { Circle, Path } from 'react-native-svg'

/** Quiet navigation/tool glyphs; the parent button owns the touch target and label. */
export function ActionIcon({
  name,
  size = 24,
  color,
}: {
  name: 'back' | 'add' | 'more' | 'refresh'
  size?: number
  color: string
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      pointerEvents="none"
    >
      {name === 'more' ? (
        <>
          <Circle cx={5} cy={12} r={1.4} fill={color} />
          <Circle cx={12} cy={12} r={1.4} fill={color} />
          <Circle cx={19} cy={12} r={1.4} fill={color} />
        </>
      ) : (
        <Path
          d={name === 'back' ? 'M15 5 L8 12 L15 19' : name === 'refresh'
            ? 'M20 5 V10 H15 M19.5 10 A8 8 0 1 0 20 15'
            : 'M12 4 V20 M4 12 H20'}
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </Svg>
  )
}
