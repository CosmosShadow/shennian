import { createElement, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { getServerUrl } from '../../config/server'
import {
  SHENNIAN_AGENT_INSTALL_DOC_URL,
  SHENNIAN_CLI_INSTALL_COMMAND,
} from '../machines/installPrompt'
import {
  pickDesktopDownloadUrl,
  type DesktopReleaseInfo,
} from './landingDownloads'
import { C, s } from './landingTheme'

const IOS_APP_STORE_URL = 'https://apps.apple.com/us/app/%E7%A5%9E%E5%BF%B5/id6761320881'

let QRCode: any = null
try {
  QRCode = require('react-native-qrcode-svg').default
} catch {
  /* noop */
}

// Native <img> tag (web-only) keeps screenshots crisp at device DPI.
// react-native-web's <Image> renders as a background-image which the browser
// downsamples and looks blurry for high-res product screens.
export function CrispImg({
  src,
  alt,
  fit = 'cover',
  radius = 0,
  eager = false,
}: {
  src: string
  alt: string
  fit?: 'cover' | 'contain'
  radius?: number
  // The hero showcase needs eager loading; feature cards below the fold
  // can stay lazy. Defaults to lazy to keep behavior predictable.
  eager?: boolean
}) {
  return createElement('img', {
    src,
    alt,
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    fetchPriority: eager ? 'high' : 'auto',
    style: {
      width: '100%',
      height: '100%',
      objectFit: fit,
      borderRadius: radius,
      display: 'block',
      backgroundColor: '#FFFFFF',
    },
  })
}

export function CrispContainImg({
  src,
  alt,
  maxWidth,
}: {
  src: string
  alt: string
  maxWidth?: number | string
}) {
  return createElement('img', {
    src,
    alt,
    loading: 'lazy',
    decoding: 'async',
    style: {
      width: '100%',
      maxWidth,
      height: 'auto',
      objectFit: 'contain',
      display: 'block',
    },
  })
}

export function NavLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
      <Text style={{ fontSize: 14, color: C.neutral600 }}>{label}</Text>
    </Pressable>
  )
}

// Two pill rows under the hero copy: which agents are supported, and which
// host operating systems can be brought online. Each agent gets a 8px
// brand-colored dot so the row reads as "logo matrix" instead of plain
// text labels — major lift on perceived authority for ~zero cost.
const AGENT_DOTS: Array<{ name: string; color: string }> = [
  { name: 'Claude', color: '#D97706' },
  { name: 'Codex', color: '#10A37F' },
  // Gemini CLI is intentionally no longer advertised.
  // { name: 'Gemini', color: '#4285F4' },
  { name: 'Cursor', color: '#000000' },
  { name: 'OpenCode', color: '#7C3AED' },
]
const OS_GLYPHS: Array<{ name: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { name: 'macOS', icon: 'logo-apple' },
  { name: 'Windows', icon: 'logo-windows' },
  { name: 'Linux', icon: 'logo-tux' },
]

function AgentPill({ name, color }: { name: string; color: string }) {
  return (
    <View
      style={s.heroSupportPill}
      // @ts-expect-error className is a valid web prop on react-native-web View
      className="sn-hover-pill"
    >
      <View style={[s.heroSupportPillDot, { backgroundColor: color }]} />
      <Text style={s.heroSupportPillText}>{name}</Text>
    </View>
  )
}

export function HeroSupportStrip() {
  const { t } = useTranslation()
  return (
    <View style={s.heroSupport}>
      <Text style={s.heroSupportLabel}>{t('landing_support_label')}</Text>
      <View style={s.heroSupportItems}>
        {AGENT_DOTS.map((a) => (
          <AgentPill key={a.name} name={a.name} color={a.color} />
        ))}
        <View
          style={s.heroSupportPill}
          // @ts-expect-error className is a valid web prop on react-native-web View
          className="sn-hover-pill"
        >
          <Ionicons name="add" size={11} color={C.brand} />
          <Text style={s.heroSupportPillText}>{t('landing_support_custom')}</Text>
        </View>
      </View>
      <Text style={[s.heroSupportLabel, { marginTop: 4 }]}>{t('landing_os_label')}</Text>
      <View style={s.heroSupportItems}>
        {OS_GLYPHS.map((os) => (
          <View
            key={os.name}
            style={s.heroSupportPill}
            // @ts-expect-error className is a valid web prop on react-native-web View
            className="sn-hover-pill"
          >
            <Ionicons name={os.icon} size={11} color={C.neutral700} />
            <Text style={s.heroSupportPillText}>{os.name}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// macOS-style window frame around a desktop screenshot. When the screenshot
// already contains the native macOS chrome (traffic lights + titlebar) we
// skip our synthetic title bar so the two don't double up.
export function MacWindow({
  src,
  alt,
  title,
  compact = false,
  bareFrame = false,
}: {
  src: string
  alt: string
  title?: string
  compact?: boolean
  bareFrame?: boolean
}) {
  return (
    <View style={[s.macWindow, compact && s.macWindowCompact]}>
      {bareFrame ? null : (
        <View style={s.macTitleBar}>
          <View style={[s.macDot, s.macDotR]} />
          <View style={[s.macDot, s.macDotY]} />
          <View style={[s.macDot, s.macDotG]} />
          <Text style={s.macTitle}>{title ?? 'Shennian'}</Text>
        </View>
      )}
      <View style={s.macBody}>
        <CrispImg src={src} alt={alt} fit="cover" eager />
      </View>
    </View>
  )
}

// iPhone-style frame floating in front of the Mac window.
export function PhoneFrame({
  src,
  alt,
  compact = false,
}: {
  src: string
  alt: string
  compact?: boolean
}) {
  return (
    <View style={[s.phoneShell, compact && s.phoneShellCompact]}>
      <View style={s.phoneScreen}>
        <CrispImg src={src} alt={alt} fit="cover" eager />
      </View>
    </View>
  )
}

// The hero centerpiece: a Mac window in the back showing the desktop client,
// an iPhone in front showing the chat. Two real product surfaces are enough
// to communicate "multi-device control plane" without faux diagrams.
export function HeroDeviceShowcase({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  return (
    <View style={[s.showcase, compact && s.showcaseCompact]}>
      <View pointerEvents="none" style={s.showcaseFloor} />

      <MacWindow
        src="/landing/privacy-preview.svg"
        alt={t('screens_cap_chat')}
        compact={compact}
        bareFrame
      />
      <PhoneFrame
        src="/landing/privacy-preview.svg"
        alt={t('screens_cap_chat')}
        compact={compact}
      />
    </View>
  )
}

// A six-card "Why Shennian" grid driven by real product screenshots
// instead of solid color blocks.
export type FeatureItem = {
  title: string
  desc: string
  src: string
  alt: string
  badge?: { label: string; color: string; bg: string }
  // 'phone' (default) renders in an iPhone-shaped frame stacked above the
  // copy. 'wide-row' lays the card horizontally with copy on the left and a
  // larger phone-shaped frame on the right — used for the headline cards
  // so the grid has visual rhythm.
  // 'wide' kept for back-compat (legacy desktop-window framing).
  layout?: 'phone' | 'wide' | 'wide-row'
}

export function ScreenshotFeatureCard({
  item,
  width,
}: {
  item: FeatureItem
  width: string | number
}) {
  const isWide = item.layout === 'wide'
  const isWideRow = item.layout === 'wide-row'

  if (isWideRow) {
    return (
      <View
        style={[s.featureCard, s.featureCardRow, { width: width as never }]}
        // @ts-expect-error className is a valid web prop on react-native-web View
        className="sn-hover-card"
      >
        <View style={s.featureRowCopy}>
          {item.badge ? (
            <View style={[s.featureBadge, { backgroundColor: item.badge.bg }]}>
              <Text style={[s.featureBadgeText, { color: item.badge.color }]}>
                {item.badge.label}
              </Text>
            </View>
          ) : null}
          <Text style={[s.featureTitle, s.featureRowTitle]}>{item.title}</Text>
          <Text style={[s.featureDesc, s.featureRowDesc]}>{item.desc}</Text>
        </View>
        <View style={s.featureRowFrame}>
          <View
            style={s.featureScreen}
            // @ts-expect-error className is a valid web prop on react-native-web View
            className="sn-hover-screen"
          >
            <View style={s.featureScreenInner}>
              <CrispImg src={item.src} alt={item.alt} fit="cover" eager />
            </View>
          </View>
          <View pointerEvents="none" style={s.featureRowFrameFade} />
        </View>
      </View>
    )
  }

  return (
    <View
      style={[s.featureCard, { width: width as never }, isWide && s.featureCardWide]}
      // @ts-expect-error className is a valid web prop on react-native-web View
      className="sn-hover-card"
    >
      <View
        style={[s.featureScreen, isWide && s.featureScreenWide]}
        // @ts-expect-error className is a valid web prop on react-native-web View
        className="sn-hover-screen"
      >
        <View style={[s.featureScreenInner, isWide && s.featureScreenInnerWide]}>
          <CrispImg src={item.src} alt={item.alt} fit="cover" eager />
        </View>
      </View>
      {item.badge ? (
        <View style={[s.featureBadge, { backgroundColor: item.badge.bg }]}>
          <Text style={[s.featureBadgeText, { color: item.badge.color }]}>{item.badge.label}</Text>
        </View>
      ) : null}
      <Text style={s.featureTitle}>{item.title}</Text>
      <Text style={s.featureDesc}>{item.desc}</Text>
    </View>
  )
}

// Legacy plain card kept for any caller that might still reference it.
export function FeatureCard({
  cols,
  color,
  bg,
  title,
  desc,
  tags,
  perRow = 3,
}: {
  cols: number
  color: string
  bg: string
  title: string
  desc: string
  tags?: string[]
  perRow?: 3 | 4
}) {
  const wideWidth = perRow === 4 ? '23.5%' : '32%'
  const cardWidth = cols === 1 ? '100%' : cols === 2 ? '48.5%' : wideWidth
  return (
    <View style={[s.card, { width: cardWidth }]}>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={s.cardDesc}>{desc}</Text>
      {tags && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 12,
          }}
        >
          {tags.map((tag) => (
            <View key={tag} style={[s.tag, { backgroundColor: bg }]}>
              <Text style={[s.tagText, { color }]}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// ----- Get Started -----

const DESKTOP_RELEASE_URL =
  'https://videoindustry.oss-cn-hangzhou.aliyuncs.com/shennian/desktop/stable/releases.json'

type OsKey = 'mac' | 'win'

const OS_TILES: { key: OsKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'mac', label: 'Mac', icon: 'logo-apple' },
  { key: 'win', label: 'Windows', icon: 'logo-windows' },
]

function CopyBlock({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    try {
      navigator.clipboard.writeText(text)
    } catch {
      // Ignore clipboard API failures on unsupported browsers.
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }, [text])

  return (
    <View style={s.copyBlock}>
      <Text style={s.copyCodeBlock}>{text}</Text>
      <Pressable onPress={copy} style={s.copyBtn}>
        <Text style={s.copyBtnText}>{copied ? t('copied') : t('copy')}</Text>
      </Pressable>
    </View>
  )
}

export function GetStartedSection({
  isWide,
}: {
  cols: number
  isWide: boolean
  handleOpenApp?: () => void
}) {
  const { t } = useTranslation()
  const [desktopRelease, setDesktopRelease] = useState<DesktopReleaseInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const base = getServerUrl()
    fetch(`${base}/download`)
      .then((r) => r.json())
      .then(() => setLoading(false))
      .catch(() => setLoading(false))

    fetch(DESKTOP_RELEASE_URL)
      .then((r) => r.json())
      .then((data: DesktopReleaseInfo) => {
        if (data?.version) setDesktopRelease(data)
      })
      .catch(() => {})
  }, [])

  const baseUrl = getServerUrl()
  const androidDownloadUrl = `${baseUrl}/download/android`
  const aiInstallPrompt = t('gs_ai_install_prompt', { url: SHENNIAN_AGENT_INSTALL_DOC_URL })
  const osUrls: Record<OsKey, string | undefined> = {
    mac: pickDesktopDownloadUrl(desktopRelease, 'mac'),
    win: pickDesktopDownloadUrl(desktopRelease, 'win'),
  }

  const stepConnect = (
    <View style={[s.gsStepCard, isWide && s.gsStepCardWide]}>
      <View style={s.gsStepNumber}>
        <Text style={s.gsStepNumberText}>1</Text>
      </View>
      <Text style={s.gsStepTitle}>{t('gs_step_connect_title')}</Text>
      <Text style={s.gsStepDesc}>{t('gs_step_connect_desc')}</Text>

      <View style={s.choiceHint}>
        <Ionicons name="checkmark-circle" size={14} color={C.brand} />
        <Text style={s.choiceHintText}>{t('gs_connect_choice_label')}</Text>
      </View>

      {/* Method 1 — AI install prompt */}
      <View style={[s.methodBlock, s.methodCard]}>
        <View style={s.methodHeader}>
          <Text style={s.methodBadge}>{t('gs_method_option_1')}</Text>
          <Text style={s.methodTitle}>{t('gs_method_ai_title')}</Text>
          <Text style={s.methodDesc}>{t('gs_method_ai_desc')}</Text>
        </View>
        <CopyBlock text={aiInstallPrompt} />
      </View>

      {/* Method 2 — CLI command */}
      <View style={[s.methodBlock, s.methodCard]}>
        <View style={s.methodHeader}>
          <Text style={s.methodBadge}>{t('gs_method_option_2')}</Text>
          <Text style={s.methodTitle}>{t('gs_method_cli_title')}</Text>
          <Text style={s.methodDesc}>{t('gs_method_cli_desc')}</Text>
        </View>
        <CopyBlock text={SHENNIAN_CLI_INSTALL_COMMAND} />
      </View>

      {/* Method 3 — legacy desktop downloads */}
      <View style={[s.methodBlock, s.methodCard]}>
        <View style={s.methodHeader}>
          <Text style={s.methodBadge}>{t('gs_method_option_3')}</Text>
          <Text style={s.methodTitle}>{t('gs_method_desktop_title')}</Text>
          <Text style={s.methodDesc}>{t('gs_method_desktop_desc')}</Text>
        </View>
        <View style={s.osGrid}>
          {OS_TILES.map((os) => {
            const url = osUrls[os.key]
            return (
              <View key={os.key} style={s.osTile}>
                <View style={s.osTileGlyph}>
                  <Ionicons name={os.icon} size={18} color={C.brand} />
                </View>
                <Text style={s.osTileTitle}>{os.label}</Text>
                <Pressable
                  onPress={url ? () => Linking.openURL(url) : undefined}
                  disabled={!url}
                  style={[s.osTileBtn, !url && s.osTileBtnDisabled]}
                >
                  <Text style={s.osTileBtnText}>{url ? t('gs_os_action') : t('gs_os_unavailable')}</Text>
                </Pressable>
              </View>
            )
          })}
        </View>
      </View>
    </View>
  )

  const stepUse = (
    <View style={[s.gsStepCard, isWide && s.gsStepCardWide]}>
      <View style={s.gsStepNumber}>
        <Text style={s.gsStepNumberText}>2</Text>
      </View>
      <Text style={s.gsStepTitle}>{t('gs_step_use_title')}</Text>
      <Text style={s.gsStepDesc}>{t('gs_step_use_desc')}</Text>

      <View style={s.clientGrid}>
        <ClientTile
          title="iOS"
          desc={t('gs_client_ios_desc')}
          actionLabel={t('gs_card_ios_action')}
          onPress={() => Linking.openURL(IOS_APP_STORE_URL)}
          qrValue={IOS_APP_STORE_URL}
        />
        <ClientTile
          title="Android"
          desc={t('gs_client_android_desc')}
          actionLabel={t('gs_card_android_action')}
          onPress={() => Linking.openURL(androidDownloadUrl)}
          qrValue={androidDownloadUrl}
        />
      </View>

      <Text style={s.useFootnote}>{t('gs_step_use_note')}</Text>
    </View>
  )

  return (
    <View nativeID="get-started" style={s.section}>
      <View style={s.center}>
        <Text style={s.sectionTitle}>{t('gs_title')}</Text>
        <Text style={s.sectionSub}>{t('gs_sub')}</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="small" color={C.brand} style={{ marginVertical: 24 }} />
      ) : (
        <View style={[s.gsWrap, s.gsTwoCol, isWide && s.gsTwoColWide]}>
          {stepConnect}
          {stepUse}
        </View>
      )}
    </View>
  )
}

function ClientTile({
  title,
  desc,
  actionLabel,
  onPress,
  qrValue,
}: {
  title: string
  desc: string
  actionLabel: string
  onPress?: () => void
  qrValue?: string
}) {
  return (
    <View style={s.clientTile}>
      {qrValue ? (
        <View style={s.clientTileQr}>
          {QRCode ? (
            <QRCode value={qrValue} size={68} />
          ) : (
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.neutral400 }}>QR</Text>
          )}
        </View>
      ) : (
        <View style={[s.clientTileQr, { backgroundColor: C.indigo50, borderColor: C.indigo50 }]}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: C.brand }}>{title.slice(0, 1)}</Text>
        </View>
      )}
      <View style={s.clientTileBody}>
        <Text style={s.clientTileTitle}>{title}</Text>
        <Text style={s.clientTileDesc}>{desc}</Text>
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          style={[s.clientTileBtn, !onPress && s.clientTileBtnDisabled]}
        >
          <Text style={s.clientTileBtnText}>{actionLabel} →</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function CustomAgentSection() {
  const { t } = useTranslation()
  const docsUrl = `${getServerUrl()}/docs`
  return (
    <View style={s.developerSection}>
      <View style={s.developerInner}>
        <View style={s.developerCopy}>
          <Text style={s.developerEyebrow}>{t('custom_agent_eyebrow')}</Text>
          <Text style={s.developerTitle}>{t('custom_agent_title')}</Text>
          <Text style={s.developerDesc}>{t('custom_agent_desc')}</Text>
        </View>
        <Pressable onPress={() => Linking.openURL(docsUrl)} style={s.developerCta}>
          <Text style={s.developerCtaText}>{t('custom_agent_action')} →</Text>
        </Pressable>
      </View>
    </View>
  )
}

// Re-export an unused legacy node so existing imports won't crash if any
// caller still expects them (none today, but keeps the surface stable).
export type _Reserved = ReactNode
