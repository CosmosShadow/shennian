// @arch docs/design/components.md#10-头像徽标与状态点
// @test src/__tests__/avatar-shape.test.ts

/** Identity masks stay rounded; mosaic tiles are square inside a shared inset mask. */
export function avatarBorderRadius(size: number, variant: 'identity' | 'group-tile' = 'identity'): number {
  if (variant === 'group-tile') return 0
  return Math.round(size * 0.18)
}
