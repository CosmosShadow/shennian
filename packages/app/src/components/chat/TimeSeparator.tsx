import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { formatMessageTime } from './messageTime'

export function TimeSeparator({ ts }: { ts: number }) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const label = formatMessageTime(ts, { yesterdayLabel: t('time_yesterday') })

  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  text: {
    fontSize: 11,
  },
})
