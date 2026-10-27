// @arch docs/design/components.md
// @test src/__tests__/inspiration-sections.test.ts
import { useEffect, useRef, useMemo, type ReactNode, type RefObject } from 'react'
import {
  AccessibilityInfo,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Animated,
  Modal,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  findNodeHandle,
  type ScrollViewProps,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../hooks/useTheme'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useWebModalFocus } from '../hooks/useWebModalFocus'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'

type Props = {
  isOpen: boolean
  onClose: () => void
  title: string
  headerTitle?: ReactNode
  headerLeft?: ReactNode
  headerRight?: ReactNode
  closeButtonStyle?: 'text' | 'icon'
  closeButtonSide?: 'left' | 'right'
  children: ReactNode
  preferDialogOnWeb?: boolean
  bodyBackgroundColor?: string
  avoidKeyboard?: boolean
  returnFocusRef?: RefObject<unknown>
  bodyScrollRef?: RefObject<ScrollView | null>
  bodyScrollProps?: Pick<ScrollViewProps, 'onScroll' | 'onScrollBeginDrag' | 'onMomentumScrollEnd' | 'scrollEventThrottle' | 'stickyHeaderIndices'>
}

export default function BottomSheet({
  isOpen,
  onClose,
  title,
  headerTitle,
  headerLeft,
  headerRight,
  closeButtonStyle = 'text',
  closeButtonSide = 'right',
  children,
  preferDialogOnWeb = false,
  avoidKeyboard = true,
  bodyBackgroundColor,
  returnFocusRef,
  bodyScrollRef,
  bodyScrollProps,
}: Props) {
  const slide = useRef(new Animated.Value(0)).current
  const sheetRef = useRef<View>(null)
  const closeButtonRef = useRef<View>(null)
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { width, height } = useWindowDimensions()
  const isWebDialog = preferDialogOnWeb && Platform.OS === 'web' && width >= 768
  useEscapeKey(Platform.OS === 'web' && isOpen, onClose)
  useWebModalFocus({
    visible: Platform.OS === 'web' && isOpen,
    containerRef: sheetRef,
    initialFocusRef: closeButtonRef,
    returnFocusRef,
  })

  useEffect(() => {
    if (Platform.OS === 'web' || !isOpen || !returnFocusRef) return
    const frame = requestAnimationFrame(() => {
      const handle = findNodeHandle(closeButtonRef.current)
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
    })
    return () => {
      cancelAnimationFrame(frame)
      requestAnimationFrame(() => {
        const handle = findNodeHandle(returnFocusRef.current as never)
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
      })
    }
  }, [isOpen, returnFocusRef])

  useEffect(() => {
    if (Platform.OS !== 'web') return
    Animated.timing(slide, {
      toValue: isOpen ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start()
  }, [isOpen, slide])

  const ds = useMemo(
    () => ({
      sheet: { backgroundColor: colors.bg },
      handle: { backgroundColor: colors.border },
      title: { color: colors.text },
      closeBtn: { backgroundColor: colors.surfaceHover },
      closeText: { color: colors.textSecondary },
    }),
    [colors],
  )

  if (!isOpen) return null
  const hasLeftControl = Boolean(headerLeft) || closeButtonSide === 'left'
  const closeControl = (
    <Pressable
      ref={closeButtonRef}
      accessibilityRole="button"
      accessibilityLabel={t('close')}
      onPress={onClose}
      hitSlop={6}
      style={({ pressed }) => [
        Platform.OS !== 'web' ? styles.nativeCloseButton : styles.closeBtn,
        Platform.OS === 'web' && ds.closeBtn,
        closeButtonSide === 'left' && { alignSelf: 'flex-start' },
        pressed && ds.closeBtn,
      ]}
    >
      {Platform.OS === 'web' ? (
        <Text style={[styles.closeText, ds.closeText]}>✕</Text>
      ) : closeButtonStyle === 'icon' ? (
        <Ionicons name="close" size={24} color={colors.textSecondary} />
      ) : (
        <Text style={[styles.nativeCloseText, { color: colors.brand }]}>{t('close')}</Text>
      )}
    </Pressable>
  )

  if (Platform.OS !== 'web') {
    return (
      <Modal
        visible={isOpen}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={onClose}
      >
        <SafeAreaView style={[styles.nativeRoot, { backgroundColor: colors.bg }]}>
          <View ref={sheetRef} style={styles.nativeSheet} accessibilityViewIsModal>
            <View style={[styles.nativeHeader, { borderBottomColor: colors.border }]}>
              <View style={hasLeftControl ? styles.balancedHeaderSide : styles.nativeHeaderSide}>
                {closeButtonSide === 'left' ? closeControl : headerLeft}
              </View>
              <View style={hasLeftControl ? styles.balancedTitle : styles.nativeTitle}>
                {headerTitle ?? <Text style={[styles.title, ds.title]}>{title}</Text>}
              </View>
              <View
                style={[
                  styles.nativeHeaderActions,
                  hasLeftControl ? styles.balancedHeaderSide : null,
                ]}
              >
                {headerRight}
                {closeButtonSide === 'right' ? closeControl : null}
              </View>
            </View>
            <ScrollView
              ref={bodyScrollRef}
              {...bodyScrollProps}
              style={[
                styles.nativeBody,
                bodyBackgroundColor ? { backgroundColor: bodyBackgroundColor } : null,
              ]}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={avoidKeyboard}
            >
              {children}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    )
  }

  const screenH = height || Dimensions.get('window').height
  const maxH = screenH * (isWebDialog ? 0.78 : 0.85)
  const dialogWidth = Math.min(Math.max(width * 0.72, 760), 980)
  const overlayStyle = [
    styles.overlay,
    isWebDialog ? styles.overlayDialog : styles.overlayBottom,
    { backgroundColor: isWebDialog ? 'rgba(15, 23, 42, 0.28)' : 'rgba(0,0,0,0.4)' },
  ]
  const sheet = (
    <>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />
      <Animated.View
        ref={sheetRef}
        accessible
        accessibilityViewIsModal
        style={[
          styles.sheet,
          ds.sheet,
          isWebDialog ? styles.sheetDialog : styles.sheetBottom,
          {
            maxHeight: maxH,
            width: isWebDialog ? dialogWidth : '100%',
            transform: [
              {
                translateY: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [isWebDialog ? 24 : maxH, 0],
                }),
              },
            ],
          },
        ]}
      >
        {isWebDialog ? null : (
          <View style={styles.handleWrap}>
            <View style={[styles.handle, ds.handle]} />
          </View>
        )}
        <View style={styles.header}>
          {hasLeftControl ? (
            <View style={styles.balancedHeaderSide}>
              {closeButtonSide === 'left' ? closeControl : headerLeft}
            </View>
          ) : null}
          <View style={hasLeftControl ? styles.balancedTitle : undefined}>
            {headerTitle ?? <Text style={[styles.title, ds.title]}>{title}</Text>}
          </View>
          <View style={[styles.headerActions, hasLeftControl ? styles.balancedHeaderSide : null]}>
            {headerRight}
            {closeButtonSide === 'right' ? closeControl : null}
          </View>
        </View>
        <ScrollView
          ref={bodyScrollRef}
          {...bodyScrollProps}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </Animated.View>
    </>
  )

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={onClose}>
      {avoidKeyboard ? (
        <KeyboardAvoidingView style={overlayStyle}>{sheet}</KeyboardAvoidingView>
      ) : (
        <View style={overlayStyle}>{sheet}</View>
      )}
    </Modal>
  )
}

const styles = StyleSheet.create({
  nativeRoot: { flex: 1 },
  nativeSheet: { flex: 1 },
  nativeHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  nativeHeaderSide: { width: 64 },
  balancedHeaderSide: { flex: 1 },
  balancedTitle: { flexShrink: 1, alignItems: 'center', paddingHorizontal: 8 },
  nativeTitle: {
    position: 'absolute',
    left: 96,
    right: 96,
    alignItems: 'center',
  },
  nativeHeaderActions: {
    minWidth: 64,
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  nativeCloseButton: {
    minWidth: Platform.OS === 'android' ? 48 : 44,
    minHeight: Platform.OS === 'android' ? 48 : 44,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeCloseText: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  nativeBody: { flex: 1, paddingHorizontal: 16 },
  overlay: {
    flex: 1,
  },
  overlayBottom: {
    justifyContent: 'flex-end',
  },
  overlayDialog: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  sheet: {
    paddingBottom: 20,
  },
  sheetBottom: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  sheetDialog: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 28 },
    shadowOpacity: 0.16,
    shadowRadius: 42,
    elevation: 24,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'flex-end',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 15,
  },
  body: {
    paddingHorizontal: 16,
  },
  bodyContent: {
    paddingBottom: 16,
  },
})
