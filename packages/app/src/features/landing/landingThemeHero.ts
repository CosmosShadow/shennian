// @arch docs/architecture/app/modular-features.md
// @test src/__tests__/server-config.test.ts

import { C } from './landingThemeTokens'

export const heroStyles = {
// ----- Page chrome -----
  root: { flex: 1, backgroundColor: C.bg },
  rootContent: { minHeight: '100%' },

  // The whole hero canvas (nav + hero) shares one ambient background so
  // there is no visible seam at the bottom of the nav.
  heroCanvas: {
    position: 'relative',
    overflow: 'hidden',
  },

  navOuter: {
    position: 'sticky' as never,
    top: 0,
    zIndex: 50,
    alignItems: 'center',
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' as never,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  navOuterMobile: {
    paddingTop: 'max(16px, calc(env(safe-area-inset-top, 0px) + 16px))' as never,
    paddingHorizontal: 14,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    ...({
      backdropFilter: 'saturate(180%) blur(20px)',
      WebkitBackdropFilter: 'saturate(180%) blur(20px)',
      boxShadow:
        '0 1px 0 rgba(255,255,255,0.6) inset, 0 2px 4px rgba(15,23,42,0.04), 0 14px 36px rgba(15,23,42,0.10), 0 24px 56px rgba(99,102,241,0.10)',
    } as object),
  },
  navMobile: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  navBrand: { fontSize: 16, fontWeight: '700', color: C.neutral900, letterSpacing: -0.3 },
  navLink: { paddingHorizontal: 12, paddingVertical: 6 },
  navLinkText: { fontSize: 14, color: C.neutral600 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navActionsMobile: {
    flexShrink: 1,
    justifyContent: 'flex-end',
    minWidth: 0,
    gap: 6,
  },
  langBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navCta: {
    backgroundColor: C.brand,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    ...({
      boxShadow: '0 4px 14px rgba(99,102,241,0.35), 0 1px 0 rgba(255,255,255,0.3) inset',
    } as object),
  },
  navCtaMobile: { paddingHorizontal: 10 },
  navCtaText: { color: C.white, fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
  navLoginBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  navLoginBtnMobile: { paddingHorizontal: 8 },
  navLoginBtnText: { fontSize: 14, fontWeight: '500', color: C.neutral700 },

  // ----- CTAs -----
  ctaPrimary: {
    backgroundColor: C.brand,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 13,
    ...({
      boxShadow:
        '0 1px 0 rgba(255,255,255,0.35) inset, 0 10px 24px rgba(99,102,241,0.32), 0 2px 6px rgba(99,102,241,0.18)',
    } as object),
  },
  ctaPrimaryText: { color: C.white, fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },

  ctaSecondary: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 13,
    ...({
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.6) inset, 0 6px 18px rgba(15,23,42,0.06)',
    } as object),
  },
  ctaSecondaryText: { color: C.neutral800, fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },

  // ----- Hero -----
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  heroEyebrow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.18)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 22,
    ...({
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: '0 4px 12px rgba(99,102,241,0.10)',
    } as object),
  },
  heroEyebrowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.green600,
    ...({
      boxShadow: '0 0 0 4px rgba(22,163,74,0.18)',
    } as object),
  },
  heroEyebrowText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.neutral700,
    letterSpacing: 0.1,
  },
  heroTitle: {
    fontSize: 56,
    fontWeight: '800',
    color: C.neutral900,
    textAlign: 'center',
    maxWidth: 640,
    marginBottom: 22,
    letterSpacing: -1.6,
    lineHeight: 62,
  },
  heroTitleAccent: {
    color: C.brand,
  },
  // Latin runs (e.g. "AI Agent") drop one weight so visual mass matches
  // CJK glyphs at the same font size. Without this, "AI Agent" looks
  // thinner than the surrounding 中文 at weight 800.
  heroTitleLatin: {
    fontWeight: '600',
    letterSpacing: -1.2,
  },
  heroSub: {
    fontSize: 18,
    lineHeight: 28,
    color: C.neutral600,
    textAlign: 'center',
    maxWidth: 540,
    marginBottom: 22,
    letterSpacing: -0.2,
  },
  heroSupport: { width: '100%', maxWidth: 540, marginBottom: 28, gap: 8 },
  heroSupportLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    color: C.neutral500,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  heroSupportItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroSupportItem: {
    fontSize: 12,
    lineHeight: 18,
    color: C.neutral800,
    fontWeight: '500',
    borderWidth: 1,
    borderColor: 'rgba(23,23,23,0.07)',
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    ...({
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    } as object),
  },
  heroSupportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(23,23,23,0.07)',
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderRadius: 999,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 4,
    ...({
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    } as object),
  },
  heroSupportPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  heroSupportPillText: {
    fontSize: 12,
    lineHeight: 16,
    color: C.neutral800,
    fontWeight: '500',
    letterSpacing: -0.1,
  },

  // ----- Hero device showcase (legacy 2-device version, kept for fallback) -----
  showcase: {
    position: 'relative',
    width: '100%',
    minHeight: 480,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showcaseCompact: { minHeight: 380 },

  // ----- Hero orchestra (one phone, three machines) -----
  // The SVG is absolutely positioned to fill the canvas; the iPhone is an
  // HTML overlay anchored to the bottom-center so we can reuse a real
  // device-shaped frame around the screenshot.
  orchestra: {
    position: 'relative',
    width: '100%',
    aspectRatio: 600 / 540,
    maxWidth: 560,
    alignSelf: 'center',
  },
  orchestraCompact: {
    maxWidth: 360,
  },
  orchestraPhone: {
    position: 'absolute',
    left: '50%',
    bottom: '6%',
    width: '24%',
    aspectRatio: 9 / 19.5,
    borderRadius: 28,
    padding: 4,
    backgroundColor: '#0A0A0A',
    ...({
      transform: 'translateX(-50%)',
      boxShadow:
        '0 1px 0 rgba(255,255,255,0.18) inset, 0 30px 80px rgba(15,23,42,0.32), 0 12px 24px rgba(99,102,241,0.18)',
    } as object),
  },
  orchestraPhoneCompact: {
    width: '34%',
    bottom: '4%',
  },
  orchestraPhoneScreen: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: C.white,
    position: 'relative',
  },
  // Dispatch dot pulses at the top of the iPhone whenever the phone is
  // sending. The keyframe animation is applied via the .sn-dispatch-dot
  // CSS class (see LandingMotion.tsx) because RN's StyleSheet warns on
  // the `animation` shorthand.
  orchestraDispatchDot: {
    position: 'absolute',
    top: -3,
    left: '50%',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#A5B4FC',
    opacity: 0,
    ...({
      transform: 'translateX(-50%)',
      transition: 'opacity 400ms ease',
      boxShadow: '0 0 0 4px rgba(165,180,252,0.25), 0 0 16px rgba(99,102,241,0.6)',
    } as object),
  },
  orchestraDispatchDotActive: {
    opacity: 1,
  },
  // Soft floating reflection under the devices.
  showcaseFloor: {
    position: 'absolute',
    bottom: 12,
    left: '10%',
    right: '10%',
    height: 60,
    borderRadius: 999,
    backgroundColor: 'rgba(99,102,241,0.16)',
    opacity: 0.6,
    ...({ filter: 'blur(28px)' } as object),
  },
  // macOS-style window frame holding a desktop screenshot.
  macWindow: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    maxWidth: 520,
    aspectRatio: 2078 / 1616,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    overflow: 'hidden',
    ...({
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      boxShadow:
        '0 1px 0 rgba(255,255,255,0.8) inset, 0 30px 70px rgba(15,23,42,0.18), 0 12px 24px rgba(99,102,241,0.10)',
      transform: 'rotate(-2deg)',
    } as object),
  },
  macWindowCompact: {
    maxWidth: 320,
    ...({ transform: 'rotate(-1.5deg)' } as object),
  },
  macTitleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15,23,42,0.06)',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  macDot: { width: 10, height: 10, borderRadius: 5 },
  macDotR: { backgroundColor: '#FF5F57' },
  macDotY: { backgroundColor: '#FEBC2E' },
  macDotG: { backgroundColor: '#28C840' },
  macTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: C.neutral400,
    fontWeight: '500',
    marginLeft: -32,
  },
  macBody: { flex: 1, backgroundColor: C.neutral50 },

  // iPhone frame floating in front, slightly to the right and lower.
  phoneShell: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: '46%',
    maxWidth: 240,
    aspectRatio: 9 / 19.5,
    borderRadius: 38,
    padding: 6,
    backgroundColor: '#0A0A0A',
    ...({
      boxShadow:
        '0 1px 0 rgba(255,255,255,0.15) inset, 0 30px 80px rgba(15,23,42,0.30), 0 8px 16px rgba(15,23,42,0.18)',
      transform: 'rotate(3deg)',
    } as object),
  },
  phoneShellCompact: {
    width: '60%',
    maxWidth: 200,
    ...({ transform: 'rotate(2deg)' } as object),
  },
  phoneScreen: {
    flex: 1,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: C.white,
  },
  // Floating Agent chips around the showcase to suggest "many agents".
  agentChip: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...({
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: '0 8px 22px rgba(15,23,42,0.10)',
    } as object),
  },
  agentChipText: { fontSize: 11, fontWeight: '600', color: C.neutral800, letterSpacing: -0.1 },
  agentChipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green600 }
} as const
