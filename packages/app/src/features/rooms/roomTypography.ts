// @arch docs/design/foundations.md#2-字体
// @test src/__tests__/room-message-layout.test.ts
import { chatTypography } from '../chat/preferences/chatFontSize'

/** Default scale; rendered messages also apply the current device preference. */
export const roomTypography = chatTypography.medium
