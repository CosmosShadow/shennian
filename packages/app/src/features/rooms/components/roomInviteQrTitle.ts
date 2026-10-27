// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

const TITLE_WIDTH = 248
const MAX_FONT_SIZE = 18
const MIN_FONT_SIZE = 10

function textUnits(value: string) {
  return Array.from(value).reduce((total, character) => {
    return total + (/^[\x00-\xff]$/.test(character) ? 0.58 : 1)
  }, 0)
}

function fitDisplayName(roomName: string, formatTitle: (displayName: string) => string) {
  const name = roomName.trim()
  if (textUnits(formatTitle(name)) <= TITLE_WIDTH / MIN_FONT_SIZE) return name

  let fitted = ''
  for (const character of Array.from(name)) {
    const candidate = `${fitted}${character}…`
    if (textUnits(formatTitle(candidate)) > TITLE_WIDTH / MIN_FONT_SIZE) break
    fitted += character
  }
  return `${fitted}…`
}

export function fitInviteQrTitle(roomName: string, formatTitle: (displayName: string) => string) {
  const displayName = fitDisplayName(roomName, formatTitle)
  const title = formatTitle(displayName)
  const fontSize = Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, Math.floor(TITLE_WIDTH / textUnits(title))),
  )
  return { displayName, title, fontSize }
}
