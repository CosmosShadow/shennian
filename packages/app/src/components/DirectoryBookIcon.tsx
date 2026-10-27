// @arch docs/design/patterns.md#1-一级根页面
import Svg, { Path } from 'react-native-svg'

/** A directory book, without a person silhouette. */
export function DirectoryBookIcon({ color, selected = false, size = 23 }: { color: string; selected?: boolean; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.5 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"
        fill={selected ? color : 'none'}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 3.5v17 M11 9h5 M11 12h5 M11 15h3.5"
        stroke={selected ? '#fff' : color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M3 8h2 M3 16h2" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  )
}
