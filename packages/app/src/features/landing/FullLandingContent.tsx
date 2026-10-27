// @arch docs/features/free-growth-phase.md
// @test src/__tests__/landing-simplification.test.ts

import React, { createElement, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { Link } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { getServerUrl } from '../../config/server'
import {
  readBrowserViewport,
  resolveLandingViewport,
  type LandingViewport,
} from './landingViewport'

import { ContactDialog } from '../contact/ContactOptions'

const AMBIENT_IMAGE = '/landing/shennian-ambient-v2.webp'
const IOS_APP_STORE_URL = 'https://apps.apple.com/us/app/%E7%A5%9E%E5%BF%B5/id6761320881'

let QRCode: any = null
try {
  QRCode = require('react-native-qrcode-svg').default
} catch {
  /* QR code is optional during non-web static evaluation. */
}

function AmbientImage({ isWide }: { isWide: boolean }) {
  const drift = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!isWide) return
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 10000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 10000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [drift, isWide])

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        isWide
          ? {
              transform: [
                { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [-4, 4] }) },
                { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1.01, 1.025] }) },
              ],
            }
          : null,
      ]}
    >
      {createElement('img', {
        src: AMBIENT_IMAGE,
        alt: '',
        'aria-hidden': true,
        draggable: false,
        decoding: 'async',
        fetchPriority: 'high',
        style: {
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'cover',
          objectPosition: isWide ? 'center center' : '56% center',
          userSelect: 'none',
        },
      })}
    </Animated.View>
  )
}

function DownloadQr({ value, size }: { value: string; size: number }) {
  return QRCode ? (
    <View style={styles.qrShell}>
      <QRCode value={value} size={size} color="#263A69" backgroundColor="#FFFFFF" />
    </View>
  ) : null
}

function DownloadItem({
  title,
  url,
  qrSize,
  isPhone,
  icon,
}: {
  title: string
  url: string
  qrSize: number
  isPhone: boolean
  icon: 'logo-apple' | 'logo-android'
}) {
  return (
    <View style={[styles.downloadItem, isPhone && styles.downloadItemPhone]}>
      {isPhone ? null : <DownloadQr value={url} size={qrSize} />}
      <Link
        href={url as never}
        target="_blank"
        style={[styles.accessLink, isPhone && styles.accessCard]}
      >
        {isPhone ? <Ionicons name={icon} size={21} color="#2F4FA7" /> : null}
        <Text style={[styles.accessLinkText, isPhone && styles.accessLinkTextPhone]}>{title}</Text>
        <Ionicons
          name={isPhone ? 'chevron-forward' : 'arrow-up-outline'}
          size={isPhone ? 17 : 13}
          color={isPhone ? '#7888AA' : '#4168C5'}
        />
      </Link>
    </View>
  )
}

export default function LandingContent() {
  const { t } = useTranslation()
  const nativeViewport = useWindowDimensions()
  const [browserViewport, setBrowserViewport] = useState<LandingViewport | null>(() =>
    readBrowserViewport(),
  )
  const { width, height } = resolveLandingViewport(nativeViewport, browserViewport)
  const isWide = width >= 860
  const isPhone = width < 600
  const [contactOpen, setContactOpen] = useState(false)
  const androidDownloadUrl = `${getServerUrl()}/download/android`

  useEffect(() => {
    const updateViewport = () => setBrowserViewport(readBrowserViewport())
    updateViewport()
    window.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('resize', updateViewport)
    return () => {
      window.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('resize', updateViewport)
    }
  }, [])

  return (
    <View
      style={[
        styles.root,
        (isWide ? { height, maxHeight: height } : { minHeight: '100dvh' }) as never,
        { overflowY: 'auto', overflowX: 'hidden' } as never,
      ]}
    >
      <View style={[styles.canvas, { minHeight: isWide ? height : ('100dvh' as never) }]}>
        <AmbientImage isWide={isWide} />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundImage: isWide
                ? 'linear-gradient(112deg, rgba(255,255,255,0.88) 4%, rgba(248,250,255,0.74) 46%, rgba(240,246,255,0.46) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(248,250,255,0.70) 55%, rgba(237,246,255,0.58) 100%)',
            } as never,
          ]}
        />

        <View style={[styles.content, !isWide && styles.contentMobile]}>
          <View style={[styles.brandColumn, !isWide && styles.brandColumnMobile]}>
            <Text style={[styles.brand, !isWide && styles.brandMobile]}>{t('footer_brand')}</Text>
            <Text style={[styles.tagline, !isWide && styles.taglineMobile]}>
              {t('landing_home_tagline')}
            </Text>
            <Text style={[styles.definition, !isWide && styles.definitionMobile]}>
              {t('landing_home_definition')}
            </Text>
          </View>

          <View
            style={[
              styles.startColumn,
              isWide && styles.startColumnWide,
              isPhone && styles.startColumnPhone,
            ]}
          >
            <Text style={styles.accessTitle}>{t('landing_access_title')}</Text>
            <View style={[styles.accessGrid, isPhone && styles.accessGridPhone]}>
              <DownloadItem
                title="iOS"
                url={IOS_APP_STORE_URL}
                qrSize={isWide ? 82 : 68}
                isPhone={isPhone}
                icon="logo-apple"
              />
              <DownloadItem
                title="Android"
                url={androidDownloadUrl}
                qrSize={isWide ? 82 : 68}
                isPhone={isPhone}
                icon="logo-android"
              />
            </View>
          </View>
        </View>

        <View style={[styles.footer, !isWide && styles.footerMobile]}>
          <Link href="/privacy">
            <Text style={styles.utilityText}>{t('privacy_title')}</Text>
          </Link>
          <Pressable accessibilityRole="button" onPress={() => setContactOpen(true)}>
            <Text style={styles.utilityText}>{t('landing_simple_contact')}</Text>
          </Pressable>
          {isWide ? <Text style={styles.copyright}>{t('footer_copyright')}</Text> : null}
        </View>
      </View>

      <ContactDialog visible={contactOpen} onClose={() => setContactOpen(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F8FF' },
  canvas: { position: 'relative', overflow: 'hidden' },
  content: {
    width: '100%',
    maxWidth: 1180,
    flex: 1,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 54,
    paddingTop: 46,
    paddingBottom: 92,
  },
  contentMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 38,
    paddingBottom: 42,
  },
  brandColumn: { width: '43%', paddingRight: 64 },
  brandColumnMobile: { width: '100%', paddingRight: 0, alignItems: 'flex-start' },
  brand: {
    color: '#15213D',
    fontSize: 66,
    lineHeight: 78,
    fontWeight: '800',
    letterSpacing: 10,
    marginLeft: 10,
  },
  brandMobile: { fontSize: 46, lineHeight: 56, letterSpacing: 6, marginLeft: 6 },
  tagline: {
    maxWidth: 390,
    marginTop: 18,
    color: '#26395F',
    fontSize: 24,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  taglineMobile: { maxWidth: 340, marginTop: 8, fontSize: 20, lineHeight: 29 },
  definition: {
    maxWidth: 390,
    marginTop: 12,
    color: '#536482',
    fontSize: 16,
    lineHeight: 26,
    fontWeight: '500',
  },
  definitionMobile: { maxWidth: 340, marginTop: 8, fontSize: 15, lineHeight: 24 },
  startColumn: { flex: 1, marginTop: 42 },
  startColumnPhone: { flex: 0, marginTop: 38 },
  startColumnWide: {
    marginTop: 0,
    paddingLeft: 54,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(76,96,152,0.2)',
  },
  accessTitle: {
    marginTop: 0,
    marginBottom: 14,
    color: '#667895',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  accessGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  accessGridPhone: { flexDirection: 'column', gap: 10 },
  downloadItem: { flex: 1, minWidth: 0, alignItems: 'center' },
  downloadItemPhone: { width: '100%', minHeight: 52, flex: 0, alignItems: 'stretch' },
  qrShell: { padding: 6, borderRadius: 12, backgroundColor: '#FFFFFF', marginBottom: 4 },
  accessLink: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    textDecorationLine: 'none',
    textAlign: 'center',
  },
  accessCard: {
    width: '100%',
    minHeight: 52,
    marginTop: 0,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.74)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(76,96,152,0.14)',
    textAlign: 'left',
  },
  accessLinkText: { color: '#344FAE', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  accessLinkTextPhone: { flex: 1, fontSize: 15, lineHeight: 21, color: '#243A78' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 68,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  footerMobile: {
    position: 'relative',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  utilityText: { color: '#5C6880', fontSize: 13, fontWeight: '600' },
  copyright: { color: '#8992A2', fontSize: 11 },
})
