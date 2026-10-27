import { ActionIcon } from '../src/components/ActionIcon'
import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Platform,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native'
import { Redirect, Link } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { persistWebLanguagePreference } from '../src/config/i18n'
import {
  CLAUDE_CODE_AGENT_STEPS,
  CLI_COMMANDS,
  CODEX_AGENT_STEPS,
  CUSTOM_AGENT_BOUNDARIES,
  CUSTOM_AGENT_EVENT_TABLE,
  CUSTOM_AGENT_FLOW,
  CUSTOM_AGENT_MINIMAL_NODE,
  CUSTOM_AGENT_REGISTER,
  DESKTOP_STEPS,
  DOC_SECTIONS,
  FIRST_MESSAGE_STEPS,
  LOGIN_PAIRING_STEPS,
  MACHINE_MANAGEMENT_CARDS,
  MEMBERSHIP_CREDIT_CARDS,
  OTHER_AGENT_CARDS,
  PROJECT_SESSION_CARDS,
  SKILL_CARDS,
  STATUS_SYNC_CARDS,
  SUPPORT_CARDS,
} from '../src/features/docs/docsModel'

const C = {
  brand: '#6366F1',
  brandDark: '#4F46E5',
  brandLight: 'rgba(99,102,241,0.08)',
  brandBorder: 'rgba(99,102,241,0.2)',
  ink: '#171717',
  text: '#404040',
  muted: '#737373',
  faint: '#A3A3A3',
  line: '#E5E5E5',
  soft: '#F7F7F8',
  white: '#FFFFFF',
  green: '#15803D',
  code: '#171717',
  red: '#F87171',
  yellow: '#FACC15',
  codeGreen: '#4ADE80',
} as const

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement
  while (current) {
    const { overflowY, overflow } = window.getComputedStyle(current)
    const canScroll = current.scrollHeight > current.clientHeight + 1
    const scrollable = ['auto', 'scroll'].some((value) =>
      overflowY.includes(value) || overflow.includes(value),
    )
    if (canScroll && scrollable) return current
    current = current.parentElement
  }
  return null
}

function scrollToDocSection(key: string, behavior: ScrollBehavior = 'auto') {
  const target = document.getElementById(key)
  if (!target) return

  const scrollParent = findScrollParent(target)
  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const top = Math.max(0, scrollParent.scrollTop + targetRect.top - parentRect.top - 24)
    scrollParent.scrollTo({ top, behavior })
    window.requestAnimationFrame(() => {
      if (Math.abs(scrollParent.scrollTop - top) > 4) scrollParent.scrollTop = top
    })
    return
  }

  const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 76)
  window.scrollTo({
    top,
    behavior,
  })
  window.requestAnimationFrame(() => {
    const scrollingElement = document.scrollingElement
    if (scrollingElement && Math.abs(scrollingElement.scrollTop - top) > 4) {
      scrollingElement.scrollTop = top
    }
  })
}

export default function DocsPage() {
  if (Platform.OS !== 'web') return <Redirect href="/" />
  return <DocsContent />
}

function DocsContent() {
  const { t, i18n } = useTranslation()
  const { width } = useWindowDimensions()
  const isWide = width >= 720
  const isCompact = width < 720
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeKey, setActiveKey] = useState('desktop-install')

  const sectionKeys = useMemo(
    () => new Set(DOC_SECTIONS.flatMap((section) => section.items.map((item) => item.key))),
    [],
  )

  useEffect(() => {
    const syncHash = () => {
      const key = window.location.hash.replace(/^#/, '')
      if (!sectionKeys.has(key)) return
      setActiveKey(key)
      window.setTimeout(() => scrollToDocSection(key), 0)
    }
    syncHash()
    window.addEventListener('hashchange', syncHash)
    return () => window.removeEventListener('hashchange', syncHash)
  }, [sectionKeys])

  const toggleLang = useCallback(() => {
    const next = i18n.language === 'zh' ? 'en' : 'zh'
    i18n.changeLanguage(next)
    persistWebLanguagePreference(next)
  }, [i18n])

  const navigateTo = useCallback((key: string) => {
    setActiveKey(key)
    setSidebarOpen(false)
    try {
      window.history.replaceState(null, '', `#${key}`)
      scrollToDocSection(key, 'smooth')
    } catch {}
  }, [])

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View style={s.headerInner}>
          <View style={s.row}>
            {!isWide && (
              <Pressable onPress={() => setSidebarOpen((value) => !value)} style={s.iconBtn}>
                <Text style={s.iconText}>☰</Text>
              </Pressable>
            )}
            <Link href="/landing">
              <Text style={s.headerBrand}>{t('footer_brand')}</Text>
            </Link>
            {isWide && (
              <>
                <Text style={s.crumbSep}>/</Text>
                <Text style={s.crumb}>{t('docs_page_title')}</Text>
              </>
            )}
          </View>
          <View style={s.row}>
            <Pressable onPress={toggleLang} style={s.langBtn}>
              <Text style={s.langText}>{i18n.language === 'zh' ? 'EN' : '中'}</Text>
            </Pressable>
            <Link href="/(auth)/login" asChild>
              <Pressable style={s.openBtn}>
                <Text style={s.openBtnText}>{t('landing_open_app')}</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </View>

      <View style={[s.bodyShell, !isWide && s.bodyShellFlush]}>
        <View style={s.body}>
          {(isWide || sidebarOpen) && (
            <View style={[s.sidebar, !isWide && s.sidebarMobile]}>
              {!isWide && (
                <Pressable onPress={() => setSidebarOpen(false)} style={s.closeBtn}>
                  <Text style={s.iconText}>×</Text>
                </Pressable>
              )}
              {DOC_SECTIONS.map((section) => (
                <View key={section.key} style={s.sidebarGroup}>
                  <Text style={s.sidebarTitle}>{t(section.titleKey)}</Text>
                  {section.items.map((item) => (
                    <Pressable
                      key={item.key}
                      onPress={() => navigateTo(item.key)}
                      style={[s.sidebarItem, activeKey === item.key && s.sidebarItemActive]}
                    >
                      <Text
                        style={[s.sidebarItemText, activeKey === item.key && s.sidebarItemTextActive]}
                      >
                        {t(item.titleKey)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          )}

          {sidebarOpen && !isWide && (
            <Pressable style={s.overlay} onPress={() => setSidebarOpen(false)} />
          )}

          <ScrollView style={s.main} contentContainerStyle={s.mainContent}>
            <View style={s.article}>
              <Hero t={t} />

              <DocSection id="desktop-install" eyebrow={t('docs_nav_start')} title={t('docs_desktop_install_title')}>
                <Text style={s.bodyText}>{t('docs_desktop_install_intro')}</Text>
                <CardGrid
                  cards={[
                    ['docs_method_desktop_title', 'docs_method_desktop_desc'],
                    ['docs_method_ai_title', 'docs_method_ai_desc'],
                  ]}
                  primaryIndex={0}
                  t={t}
                />
                <StepList steps={DESKTOP_STEPS} t={t} />
                <Tip text={t('docs_desktop_tip')} />
              </DocSection>

              <DocSection id="cli-install" title={t('docs_cli_install_title')}>
                <Text style={s.bodyText}>{t('docs_cli_install_intro')}</Text>
                <CodeBlock code={'npm install -g shennian@latest\nshennian'} />
                <CommandTable commands={CLI_COMMANDS} t={t} />
              </DocSection>

              <DocSection id="login-pairing" title={t('docs_login_pairing_title')}>
                <Text style={s.bodyText}>{t('docs_login_pairing_desc')}</Text>
                <StepList steps={LOGIN_PAIRING_STEPS} t={t} />
                <Tip text={t('docs_login_pairing_tip')} />
              </DocSection>

              <DocSection id="mobile-app" title={t('docs_mobile_app_title')}>
                <Text style={s.bodyText}>{t('docs_mobile_app_desc')}</Text>
                <ScreenshotRow
                  image="/landing/privacy-preview.svg"
                  alt={t('docs_mobile_app_image_alt')}
                  title={t('docs_mobile_app_card_title')}
                  desc={t('docs_mobile_app_card_desc')}
                  compact={isCompact}
                />
              </DocSection>

              <DocSection id="first-message" title={t('docs_first_message_title')}>
                <Text style={s.bodyText}>{t('docs_first_message_intro')}</Text>
                <ScreenshotRow
                  image="/landing/privacy-preview.svg"
                  alt={t('docs_machines_image_alt')}
                  title={t('docs_machines_title')}
                  desc={t('docs_machines_short')}
                  compact={isCompact}
                />
                <StepList steps={FIRST_MESSAGE_STEPS} t={t} />
              </DocSection>

              <DocSection id="membership-credits" title={t('docs_membership_credits_title')}>
                <Text style={s.bodyText}>{t('docs_membership_credits_desc')}</Text>
                <CardGrid cards={MEMBERSHIP_CREDIT_CARDS} primaryIndex={1} t={t} />
                <Tip text={t('docs_membership_credits_tip')} />
              </DocSection>

              <DocSection id="codex" title={t('docs_codex_title')}>
                <Text style={s.bodyText}>{t('docs_codex_desc')}</Text>
                <StepList steps={CODEX_AGENT_STEPS} t={t} />
                <Tip text={t('docs_codex_tip')} />
              </DocSection>

              <DocSection id="claude-code" title={t('docs_claude_code_title')}>
                <Text style={s.bodyText}>{t('docs_claude_code_desc')}</Text>
                <StepList steps={CLAUDE_CODE_AGENT_STEPS} t={t} />
                <Tip text={t('docs_claude_code_tip')} />
              </DocSection>

              <DocSection id="other-agents" title={t('docs_other_agents_title')}>
                <Text style={s.bodyText}>{t('docs_other_agents_desc')}</Text>
                <CardGrid cards={OTHER_AGENT_CARDS} t={t} />
              </DocSection>

              <DocSection id="custom-agent" title={t('docs_custom_agent_title')}>
                <Text style={s.bodyText}>{t('docs_custom_agent_intro2')}</Text>
                <CardGrid
                  cards={[
                    ['docs_custom_agent_card_caps_title', 'docs_custom_agent_card_caps_desc'],
                    ['docs_custom_agent_card_run_title', 'docs_custom_agent_card_run_desc'],
                    ['docs_custom_agent_card_events_title', 'docs_custom_agent_card_events_desc'],
                  ]}
                  primaryIndex={0}
                  t={t}
                />

                <Text style={s.h3}>{t('docs_custom_agent_flow_title')}</Text>
                <Text style={s.bodyText}>{t('docs_custom_agent_flow_desc')}</Text>
                <CodeBlock code={CUSTOM_AGENT_FLOW} />

                <Text style={s.h3}>{t('docs_custom_agent_events_title')}</Text>
                <Text style={s.bodyText}>{t('docs_custom_agent_events_desc')}</Text>
                <CommandTable commands={CUSTOM_AGENT_EVENT_TABLE} t={t} />
                <Tip text={t('docs_custom_agent_first_event_tip')} />

                <Text style={s.h3}>{t('docs_custom_agent_resume_title')}</Text>
                <Text style={s.bodyText}>{t('docs_custom_agent_resume_desc')}</Text>
                <CodeBlock
                  code={
                    '{"state":"final","agentSessionId":"native-session-123"}\n# next turn: Shennian passes --resume native-session-123'
                  }
                />

                <Text style={s.h3}>{t('docs_custom_agent_attachments_title')}</Text>
                <Text style={s.bodyText}>{t('docs_custom_agent_attachments_desc')}</Text>
                <CodeBlock
                  code={
                    'my-agent /run --workdir /path/to/project --attachment /path/to/screenshot.png --attachment /path/to/spec.pdf'
                  }
                />

                <Text style={s.h3}>{t('docs_custom_agent_node_demo')}</Text>
                <Text style={s.bodyText}>{t('docs_custom_agent_node_intro')}</Text>
                <CodeBlock code={CUSTOM_AGENT_MINIMAL_NODE} />

                <Text style={s.h3}>{t('docs_custom_agent_register_title')}</Text>
                <CodeBlock code={CUSTOM_AGENT_REGISTER} />
                <Tip text={t('docs_custom_agent_tip')} />

                <Text style={s.h3}>{t('docs_custom_agent_boundaries_title')}</Text>
                <View style={s.boundaryList}>
                  {CUSTOM_AGENT_BOUNDARIES.map((key) => (
                    <Text key={key} style={s.boundaryItem}>
                      • {t(key)}
                    </Text>
                  ))}
                </View>
              </DocSection>

              <DocSection id="files" eyebrow={t('docs_nav_capabilities')} title={t('docs_files_title')}>
                <Text style={s.bodyText}>{t('docs_files_intro')}</Text>
                <ScreenshotRow
                  image="/landing/privacy-preview.svg"
                  alt={t('docs_files_image_alt')}
                  title={t('docs_files_card_title')}
                  desc={t('docs_files_card_desc')}
                  compact={isCompact}
                />
              </DocSection>

              <DocSection id="projects-sessions" title={t('docs_projects_sessions_title')}>
                <Text style={s.bodyText}>{t('docs_projects_sessions_desc')}</Text>
                <CardGrid cards={PROJECT_SESSION_CARDS} primaryIndex={1} t={t} />
              </DocSection>

              <DocSection id="skills" title={t('docs_skills_title')}>
                <Text style={s.bodyText}>{t('docs_skills_desc')}</Text>
                <CardGrid cards={SKILL_CARDS} primaryIndex={0} t={t} />
                <Tip text={t('docs_skills_arch_tip')} />
              </DocSection>

              <DocSection id="multi-device" title={t('docs_multi_device_title')}>
                <Text style={s.bodyText}>{t('docs_multi_device_desc')}</Text>
                <ScreenshotRow
                  image="/landing/privacy-preview.svg"
                  alt={t('docs_multi_device_image_alt')}
                  title={t('docs_multi_device_card_title')}
                  desc={t('docs_multi_device_card_desc')}
                  reverse={isWide}
                  compact={isCompact}
                />
              </DocSection>

              <DocSection id="status-sync" title={t('docs_status_sync_title')}>
                <Text style={s.bodyText}>{t('docs_status_sync_desc')}</Text>
                <CardGrid cards={STATUS_SYNC_CARDS} t={t} />
                <Tip text={t('docs_status_sync_tip')} />
              </DocSection>

              <DocSection id="machines" title={t('docs_machine_management_title')}>
                <Text style={s.bodyText}>{t('docs_machine_management_desc')}</Text>
                <CardGrid cards={MACHINE_MANAGEMENT_CARDS} t={t} />
              </DocSection>

              <DocSection id="troubleshooting" eyebrow={t('docs_nav_support')} title={t('docs_troubleshooting_title')}>
                <Text style={s.bodyText}>{t('docs_troubleshooting_intro2')}</Text>
                <CardGrid cards={SUPPORT_CARDS} t={t} />
                <CodeBlock code={'shennian status\nshennian logs -n 100\nshennian stop && shennian start\nshennian pair'} />
                <Tip text={t('docs_restart_warning')} />
              </DocSection>

              <DocSection id="customer-support" title={t('docs_customer_support_title')}>
                <Text style={s.bodyText}>{t('docs_customer_support_desc')}</Text>
                <QrSupportCard t={t} />
              </DocSection>

              <View style={s.backLink}>
                <Link href="/landing">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActionIcon name="back" color="#4262B4" />
                    <Text style={s.backText}>{t('docs_back_home')}</Text>
                  </View>
                </Link>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  )
}

function Hero({ t }: { t: (key: string) => string }) {
  return (
    <View style={s.hero}>
      <Text style={s.h1}>{t('docs_overview_title')}</Text>
      <Text style={s.lead}>{t('docs_overview_intro')}</Text>
      <View style={s.heroActions}>
        <Link href="/landing#get-started" asChild>
          <Pressable style={s.primaryBtn}>
            <Text style={s.primaryBtnText}>{t('docs_download_desktop')}</Text>
          </Pressable>
        </Link>
        <Link href="/(auth)/login" asChild>
          <Pressable style={s.secondaryBtn}>
            <Text style={s.secondaryBtnText}>{t('landing_open_app')}</Text>
          </Pressable>
        </Link>
      </View>
      <View style={s.heroImage}>
        <DocImage src="/landing/privacy-preview.svg" alt={t('docs_desktop_image_alt')} />
      </View>
    </View>
  )
}

function DocSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string
  eyebrow?: string
  title: string
  children: ReactNode
}) {
  return (
    <View nativeID={id} style={s.section}>
      {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
      <Text style={s.h2}>{title}</Text>
      {children}
    </View>
  )
}

function CardGrid({
  cards,
  primaryIndex,
  t,
}: {
  cards: readonly (readonly [string, string])[]
  primaryIndex?: number
  t: (key: string) => string
}) {
  return (
    <View style={s.methodGrid}>
      {cards.map(([titleKey, descKey], index) => (
        <MethodCard
          key={titleKey}
          title={t(titleKey)}
          desc={t(descKey)}
          primary={index === primaryIndex}
        />
      ))}
    </View>
  )
}

function MethodCard({ title, desc, primary }: { title: string; desc: string; primary?: boolean }) {
  return (
    <View style={[s.methodCard, primary && s.methodCardPrimary]}>
      <Text style={[s.methodTitle, primary && s.methodTitlePrimary]}>{title}</Text>
      <Text style={[s.methodDesc, primary && s.methodDescPrimary]}>{desc}</Text>
    </View>
  )
}

function StepList({
  steps,
  t,
}: {
  steps: readonly (readonly [string, string])[]
  t: (key: string) => string
}) {
  return (
    <View style={s.steps}>
      {steps.map(([titleKey, descKey], index) => (
        <View key={titleKey} style={s.step}>
          <View style={s.stepNum}>
            <Text style={s.stepNumText}>{index + 1}</Text>
          </View>
          <View style={s.stepCopy}>
            <Text style={s.stepTitle}>{t(titleKey)}</Text>
            <Text style={s.stepDesc}>{t(descKey)}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

function ScreenshotRow({
  image,
  alt,
  title,
  desc,
  reverse,
  compact,
}: {
  image: string
  alt: string
  title: string
  desc: string
  reverse?: boolean
  compact?: boolean
}) {
  return (
    <View style={[s.screenRow, reverse && s.screenRowReverse, compact && s.screenRowCompact]}>
      <View style={s.screenCopy}>
        <Text style={s.screenTitle}>{title}</Text>
        <Text style={s.screenDesc}>{desc}</Text>
      </View>
      <View style={s.phoneShot}>
        <DocImage src={image} alt={alt} />
      </View>
    </View>
  )
}

function CommandTable({
  commands,
  t,
}: {
  commands: readonly (readonly [string, string])[]
  t: (key: string) => string
}) {
  return (
    <View style={s.table}>
      {commands.map(([command, descKey]) => (
        <CommandRow key={command} command={command} desc={t(descKey)} />
      ))}
    </View>
  )
}

function CommandRow({ command, desc }: { command: string; desc: string }) {
  return (
    <View style={s.commandRow}>
      <Text style={s.command}>{command}</Text>
      <Text style={s.commandDesc}>{desc}</Text>
    </View>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <View style={s.codeBlock}>
      <View style={s.codeDots}>
        <View style={[s.dot, { backgroundColor: C.red }]} />
        <View style={[s.dot, { backgroundColor: C.yellow }]} />
        <View style={[s.dot, { backgroundColor: C.codeGreen }]} />
      </View>
      <View style={s.codeContent}>
        {code.split('\n').map((line, index) => (
          <Text key={`${index}-${line}`} style={s.codeLine}>
            <Text style={line.startsWith('#') ? s.codeMuted : s.codeText}>
              {line.length > 0 ? line : ' '}
            </Text>
          </Text>
        ))}
      </View>
    </View>
  )
}

function Tip({ text }: { text: string }) {
  return (
    <View style={s.tip}>
      <Text style={s.tipText}>{text}</Text>
    </View>
  )
}

function QrSupportCard({ t }: { t: (key: string) => string }) {
  return (
    <View style={s.qrCard}>
      <View style={s.qrFrame}>
        <DocImage src="/landing/wechat-group-qr.jpg" alt={t('docs_customer_support_qr_alt')} />
      </View>
    </View>
  )
}

function DocImage({ src, alt }: { src: string; alt: string }) {
  return createElement('img', {
    src,
    alt,
    loading: 'lazy',
    decoding: 'async',
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      display: 'block',
    },
  })
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  header: {
    position: 'sticky' as any,
    top: 0,
    zIndex: 50,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(229,229,229,0.75)',
    backgroundColor: 'rgba(255,255,255,0.94)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 1280,
    alignSelf: 'center',
    width: '100%',
  },
  headerBrand: { fontSize: 16, fontWeight: '700', color: C.ink },
  crumbSep: { color: C.line, marginHorizontal: 8 },
  crumb: { fontSize: 14, color: C.muted },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 16, color: C.muted },
  langBtn: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  langText: { fontSize: 12, fontWeight: '600', color: C.muted },
  openBtn: {
    backgroundColor: C.brand,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  openBtnText: { color: C.white, fontSize: 14, fontWeight: '600' },
  bodyShell: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 16,
  },
  bodyShellFlush: {
    paddingHorizontal: 0,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
  },
  sidebar: {
    width: 250,
    borderRightWidth: 1,
    borderRightColor: 'rgba(229,229,229,0.7)',
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  sidebarMobile: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 40,
    backgroundColor: C.white,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  closeBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarGroup: { marginBottom: 22 },
  sidebarTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: C.text,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  sidebarItem: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 2 },
  sidebarItemActive: { backgroundColor: C.brandLight },
  sidebarItemText: { fontSize: 15, color: C.muted },
  sidebarItemTextActive: { color: C.brandDark, fontWeight: '700' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  main: { flex: 1 },
  mainContent: { paddingHorizontal: 24, paddingVertical: 44 },
  article: { maxWidth: 820, width: '100%' },
  hero: { marginBottom: 72 },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: C.brandBorder,
    backgroundColor: C.brandLight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 14,
  },
  badgeText: { fontSize: 12, fontWeight: '700', color: C.brandDark },
  h1: { fontSize: 38, lineHeight: 46, fontWeight: '800', color: C.ink, marginBottom: 14 },
  lead: { fontSize: 17, lineHeight: 28, color: C.muted, maxWidth: 680 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 24 },
  primaryBtn: {
    backgroundColor: C.ink,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryBtnText: { color: C.white, fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  secondaryBtnText: { color: C.text, fontSize: 14, fontWeight: '700' },
  heroImage: {
    height: 330,
    marginTop: 28,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    backgroundColor: C.soft,
    overflow: 'hidden',
  },
  section: { marginBottom: 72 },
  eyebrow: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
    color: C.green,
    marginBottom: 8,
  },
  h2: { fontSize: 30, lineHeight: 38, fontWeight: '800', color: C.ink, marginBottom: 12 },
  h3: {
    fontSize: 21,
    lineHeight: 30,
    fontWeight: '800',
    color: C.ink,
    marginTop: 20,
    marginBottom: 8,
  },
  h4: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
    color: C.ink,
    marginTop: 18,
    marginBottom: 8,
  },
  bodyText: { fontSize: 15, lineHeight: 25, color: C.muted, marginBottom: 18 },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  methodCard: {
    flexGrow: 1,
    flexBasis: 240,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    padding: 14,
    backgroundColor: C.white,
  },
  methodCardPrimary: { borderColor: C.brandBorder, backgroundColor: C.brandLight },
  methodTitle: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 6 },
  methodTitlePrimary: { color: C.brandDark },
  methodDesc: { fontSize: 13, lineHeight: 20, color: C.muted },
  methodDescPrimary: { color: C.text },
  steps: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  step: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(229,229,229,0.65)',
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: C.brandLight,
    borderWidth: 1,
    borderColor: C.brandBorder,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: { fontSize: 12, fontWeight: '800', color: C.brandDark, fontFamily: 'monospace' },
  stepCopy: { flex: 1 },
  stepTitle: { fontSize: 14, fontWeight: '800', color: C.ink, marginBottom: 4 },
  stepDesc: { fontSize: 13, lineHeight: 20, color: C.muted },
  tip: { backgroundColor: C.soft, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  tipText: { fontSize: 13, lineHeight: 20, color: C.text },
  screenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    backgroundColor: C.soft,
    padding: 18,
    marginBottom: 18,
  },
  screenRowReverse: { flexDirection: 'row-reverse' },
  screenRowCompact: { flexDirection: 'column', alignItems: 'stretch' },
  screenCopy: { flex: 1.05 },
  screenTitle: { fontSize: 18, lineHeight: 25, fontWeight: '800', color: C.ink, marginBottom: 8 },
  screenDesc: { fontSize: 14, lineHeight: 23, color: C.muted },
  phoneShot: {
    width: 220,
    height: 420,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    flexShrink: 0,
  },
  qrCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    backgroundColor: C.soft,
    padding: 18,
    marginBottom: 18,
    flexWrap: 'wrap',
  },
  qrFrame: {
    width: 180,
    height: 180,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
    overflow: 'hidden',
  },
  table: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 14,
  },
  commandRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(229,229,229,0.65)',
  },
  command: { fontFamily: 'monospace', fontSize: 13, color: C.brandDark, minWidth: 210 },
  commandDesc: { flex: 1, fontSize: 13, lineHeight: 20, color: C.muted },
  codeBlock: {
    backgroundColor: C.code,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 14,
  },
  codeDots: {
    height: 32,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  codeContent: { paddingHorizontal: 16, paddingVertical: 14, gap: 4, overflow: 'scroll' as any },
  codeLine: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  codeText: { color: C.codeGreen },
  codeMuted: { color: 'rgba(255,255,255,0.45)' },
  boundaryList: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    padding: 14,
    gap: 8,
    backgroundColor: C.soft,
  },
  boundaryItem: { fontSize: 13, lineHeight: 20, color: C.text },
  backLink: { paddingBottom: 40 },
  backText: { fontSize: 14, color: C.muted },
})
