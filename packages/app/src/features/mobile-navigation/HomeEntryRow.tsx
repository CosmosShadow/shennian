// @arch docs/architecture/mobile-navigation.md
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { mobileFeatures } from '../../components/mobileFeatureRegistry'
import { DirectoryRow } from './DirectoryRow'
import type { HomeEntryKey } from './homeEntryPreference'
import { homePreviewTime, type HomePreview } from './homeEntryPreviews'

export const HOME_ENTRY_COLORS: Record<HomeEntryKey, string> = {
  recording: '#C34C51', schedules: '#3978C6', diary: '#8055C4', folders: '#B87918',
}
/** Home and visibility settings share exactly the same icon and preview row. */
export function HomeEntryRow({ entryKey, preview, onPress, accessory, testID }: {
  entryKey: HomeEntryKey; preview: HomePreview; onPress?: () => void; accessory?: ReactNode; testID?: string
}) {
  const { t, i18n } = useTranslation()
  const feature = mobileFeatures.find(item => item.key === entryKey)!
  return <DirectoryRow testID={testID} title={t(feature.label)} icon={feature.icon} conversationStyle
    subtitle={preview.text} time={homePreviewTime(preview.at, i18n.language)} color={HOME_ENTRY_COLORS[entryKey]}
    onPress={onPress} accessory={accessory} />
}
