import Svg, { G, Line, Path } from 'react-native-svg'

type Props = {
  size?: number
  color: string
}

export function ProjectPinIcon({ size = 12, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G transform="rotate(-35 12 12)">
        <Path
          d="M8.5 4.5h7l-1.25 4.25 2.75 2.75v1H7v-1l2.75-2.75L8.5 4.5Z"
          stroke={color}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Line
          x1="12"
          y1="13.5"
          x2="12"
          y2="21"
          stroke={color}
          strokeWidth={1.7}
          strokeLinecap="round"
        />
      </G>
    </Svg>
  )
}
