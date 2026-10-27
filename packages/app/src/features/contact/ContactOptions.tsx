// @arch docs/features/contact-and-reviews.md
// @test src/__tests__/contact-dialog.test.ts

import { useRef, useState } from 'react'
import Ionicons from '@expo/vector-icons/Ionicons'
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { HeaderIconButton } from '../../components/AppPageHeader'
import { getOfficialRoomUrl } from './links'
import { CONTACT_QR_IMAGE, saveContactQr } from './saveContactQr'

export function ContactOptions({
  onJoin,
  joining = false,
  error = '',
}: {
  onJoin?: () => void
  joining?: boolean
  error?: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [saveStatus, setSaveStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const saveBusy = useRef(false)
  const saveQr = async () => {
    if (saveBusy.current) return
    saveBusy.current = true
    setSaving(true)
    setSaveStatus('')
    try {
      const result = await saveContactQr()
      setSaveStatus(
        result === 'permission-denied'
          ? 'contact_save_permission'
          : result === 'saved'
            ? 'spaces_invite_qr_saved'
            : '',
      )
    } catch (error) {
      if (__DEV__) console.warn('[contact-qr-save]', error instanceof Error ? error.message : 'failed')
      setSaveStatus('contact_save_failed')
    } finally {
      saveBusy.current = false
      setSaving(false)
    }
  }
  const actionStyle = [styles.action, { backgroundColor: colors.brand }]
  const label = (
    <Text style={[styles.actionText, { color: colors.bg }]}>
      {t(joining ? 'contact_joining' : 'contact_join_room')}
    </Text>
  )
  if (Platform.OS !== 'web') {
    return <View style={styles.nativeContent}>
      <Text style={[styles.nativeIntro, { color: colors.textSecondary }]}>{t('mobile_contact_intro')}</Text>
      {onJoin ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: joining, busy: joining }}
        disabled={joining} onPress={onJoin} style={[styles.nativeOption, { backgroundColor: colors.surfaceHover }]}>
        <View style={[styles.nativeOptionIcon, { backgroundColor: '#e8e9ff' }]}>
          <Ionicons name="chatbubble-ellipses" size={26} color="#4f46e5" />
        </View>
        <View style={styles.nativeOptionCopy}>
          <Text style={[styles.nativeOptionTitle, { color: colors.text }]}>{t('mobile_contact_official_room')}</Text>
          <Text style={[styles.nativeOptionSubtitle, { color: colors.textSecondary }]}>{t('mobile_contact_official_room_hint')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
      </Pressable> : <Link href={getOfficialRoomUrl() as never} style={[styles.nativeOption, { backgroundColor: colors.surfaceHover }]}>
        <Text style={[styles.nativeOptionTitle, { color: colors.brand }]}>{t('mobile_contact_official_room')}</Text>
      </Link>}
      {error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.error }}>{error}</Text> : null}
      <View style={[styles.nativeOption, { backgroundColor: colors.surfaceHover }]}>
        <View style={[styles.nativeOptionIcon, { backgroundColor: '#dff8e9' }]}>
          <Ionicons name="chatbubbles" size={26} color="#16a34a" />
        </View>
        <View style={styles.nativeOptionCopy}>
          <Text style={[styles.nativeOptionTitle, { color: colors.text }]}>{t('mobile_contact_wechat')}</Text>
          <Text style={[styles.nativeOptionSubtitle, { color: colors.textSecondary }]}>{t('mobile_contact_wechat_hint')}</Text>
        </View>
      </View>
      <View style={[styles.nativeQrCard, { backgroundColor: colors.surfaceHover }]}>
        <Image accessible source={CONTACT_QR_IMAGE} accessibilityLabel={t('mobile_contact_wechat_qr')}
          style={styles.nativeQr} resizeMode="contain" />
        <Text style={[styles.nativeQrLabel, { color: colors.text }]}>{t('mobile_contact_wechat_qr')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('spaces_invite_qr_save')}
          accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={() => void saveQr()}>
          <Text style={[styles.nativeSave, { color: colors.brand }]}>{t('spaces_invite_qr_save')}</Text>
        </Pressable>
        {saveStatus ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t(saveStatus)}</Text> : null}
      </View>
    </View>
  }
  return (
    <View style={styles.content}>
      {onJoin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: joining, busy: joining }}
          disabled={joining}
          onPress={onJoin}
          style={actionStyle}
        >
          {label}
        </Pressable>
      ) : (
        <Link href={getOfficialRoomUrl() as never} style={actionStyle}>
          {label}
        </Link>
      )}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
      <Text style={[styles.separator, { color: colors.textTertiary }]}>{t('contact_or')}</Text>
      <View style={styles.wechat}>
        <View style={styles.wechatHeading}>
          <Text style={[styles.title, { color: colors.text }]}>{t('contact_wechat')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('spaces_invite_qr_save')}
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => void saveQr()}
            style={styles.download}
          >
            <Ionicons name="download-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Image
          accessible
          source={CONTACT_QR_IMAGE}
          accessibilityLabel={t('contact_wechat')}
          style={styles.qr}
          resizeMode="contain"
        />
        {saveStatus ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>
            {t(saveStatus)}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

export function ContactDialog({
  visible,
  onClose,
  ...options
}: {
  visible: boolean
  onClose: () => void
} & Parameters<typeof ContactOptions>[0]) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (Platform.OS !== 'web') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={onClose}
      >
        <SafeAreaView style={[styles.nativeRoot, { backgroundColor: colors.bg }]}>
          <View style={styles.nativeHeader}>
            <View style={styles.nativeHeaderSide} />
            <Text style={[styles.nativeHeaderTitle, { color: colors.text }]}>
              {t('landing_simple_contact')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={styles.nativeHeaderSide}
              onPress={onClose}
            >
              <Ionicons name="close" size={21} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.nativeScroll}>
            <ContactOptions {...options} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    )
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Keep dismissal behind the dialog so content presses never bubble into it. */}
        <Pressable
          testID="contact-dialog-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
          tabIndex={-1}
        />
        <View style={[styles.dialog, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('landing_simple_contact')}
            </Text>
            <HeaderIconButton icon="close" label={t('close')} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.scroll}>
            <ContactOptions {...options} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  nativeRoot: { flex: 1 },
  nativeHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  nativeHeaderSide: {
    width: 64,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '600',
  },
  nativeClose: { fontSize: 17, lineHeight: 22 },
  nativeScroll: { padding: 16, paddingBottom: 32 },
  nativeContent: { gap: 12 },
  nativeIntro: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 12, marginBottom: 14 },
  nativeOption: { minHeight: 84, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  nativeOptionIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  nativeOptionCopy: { flex: 1, gap: 4 },
  nativeOptionTitle: { fontSize: 16, fontWeight: '700' },
  nativeOptionSubtitle: { fontSize: 13, lineHeight: 18 },
  nativeQrCard: { borderRadius: 14, padding: 24, alignItems: 'center', gap: 12 },
  nativeQr: { width: 190, height: 190, backgroundColor: '#fff', borderRadius: 8 },
  nativeQrLabel: { fontSize: 14, fontWeight: '600' },
  nativeSave: { fontSize: 14, fontWeight: '600', padding: 6 },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  dialog: { width: '100%', maxWidth: 400, maxHeight: '90%', borderRadius: 16, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingRight: 12,
  },
  scroll: { padding: 24, paddingTop: 12 },
  content: { gap: 12 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  action: {
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    textDecorationLine: 'none',
  },
  actionText: { color: '#FFFFFF', fontSize: 15, lineHeight: 24, fontWeight: '600' },
  separator: { fontSize: 13, lineHeight: 20, textAlign: 'center', marginVertical: 4 },
  wechatHeading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 44 },
  download: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  wechat: {
    gap: 12,
    alignItems: 'center',
  },
  qr: { width: 180, height: 180, backgroundColor: '#FFFFFF' },
})
