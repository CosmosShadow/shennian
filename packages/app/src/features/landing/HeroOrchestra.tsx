// "One phone, three machines" — landing hero centerpiece.
//
// A real iPhone screenshot anchors the bottom of the canvas; three SVG-drawn
// machines (MacBook · Windows monitor + tower · Linux 1U server) fan above
// it. A 5-phase dispatch loop sends glowing beams from the phone to each
// machine in turn, then to all three together. ~7s cycle.
//
// All SVG is built with createElement to bypass RN's intrinsic-element JSX
// namespace (which doesn't include SVG tags). Browser-native <animate> and
// <animateMotion> drive the continuous "flow" so React doesn't re-render
// every frame; only phase transitions touch the DOM.
//
// @arch docs/architecture/app/modular-features.md
// @test src/__tests__/server-config.test.ts

import { createElement, useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { C, s } from './landingTheme'

// ----- Phase machine ----------------------------------------------------

type Phase = 'idle' | 'mac' | 'win' | 'linux' | 'all'

const PHASE_ORDER: Phase[] = ['idle', 'mac', 'win', 'linux', 'all']
// Longer dispatch phases so the beams have time to read; short idle so
// the loop never feels parked.
const PHASE_DURATION_MS: Record<Phase, number> = {
  idle: 800,
  mac: 1900,
  win: 1900,
  linux: 1900,
  all: 2400,
}

function macActive(p: Phase) {
  return p === 'mac' || p === 'all'
}
function winActive(p: Phase) {
  return p === 'win' || p === 'all'
}
function linuxActive(p: Phase) {
  return p === 'linux' || p === 'all'
}

// ----- Tiny SVG builder helpers ----------------------------------------

const e = (
  tag: string,
  props: Record<string, unknown> | null,
  ...children: ReactNode[]
) => createElement(tag, props as never, ...children)

// ----- The component ---------------------------------------------------

export function HeroOrchestra({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [phaseIdx, setPhaseIdx] = useState(0)
  const phase = PHASE_ORDER[phaseIdx]

  useEffect(() => {
    const id = setTimeout(
      () => setPhaseIdx((i) => (i + 1) % PHASE_ORDER.length),
      PHASE_DURATION_MS[phase],
    )
    return () => clearTimeout(id)
  }, [phaseIdx, phase])

  const isMac = macActive(phase)
  const isWin = winActive(phase)
  const isLinux = linuxActive(phase)

  // Beam paths: phone top center is roughly (300, 305).
  const beamMacPath = 'M 300 305 C 240 260, 170 200, 130 130'
  const beamWinPath = 'M 300 305 C 300 240, 300 200, 300 150'
  const beamLinuxPath = 'M 300 305 C 360 270, 430 240, 480 215'

  // Common transition style for opacity-driven activation.
  const fade600 = { transition: 'opacity 600ms cubic-bezier(0.22, 1, 0.36, 1)' } as const

  // ----- Static defs -----
  const defs = e(
    'defs',
    null,
    // Brand-color beam gradient (purple → teal)
    e(
      'linearGradient',
      { id: 'sn-beam', x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
      e('stop', { offset: '0%', stopColor: '#A78BFA' }),
      e('stop', { offset: '60%', stopColor: '#6366F1' }),
      e('stop', { offset: '100%', stopColor: '#5EEAD4' }),
    ),
    // Soft glow filter for traveling dots
    e(
      'filter',
      { id: 'sn-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
      e('feGaussianBlur', { stdDeviation: '2.2', result: 'b' }),
      e(
        'feMerge',
        null,
        e('feMergeNode', { in: 'b' }),
        e('feMergeNode', { in: 'SourceGraphic' }),
      ),
    ),
    // Floor reflection radial fade (under iPhone)
    e(
      'radialGradient',
      { id: 'sn-floor', cx: '50%', cy: '50%', r: '50%' },
      e('stop', { offset: '0%', stopColor: 'rgba(99,102,241,0.35)' }),
      e('stop', { offset: '100%', stopColor: 'rgba(99,102,241,0.0)' }),
    ),
    // MacBook silver base gradient
    e(
      'linearGradient',
      { id: 'sn-silver', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
      e('stop', { offset: '0%', stopColor: '#F1F2F6' }),
      e('stop', { offset: '100%', stopColor: '#C9CCD4' }),
    ),
    // Mac/Windows screen "wake" glow when active
    e(
      'linearGradient',
      { id: 'sn-screen-wake', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
      e('stop', { offset: '0%', stopColor: 'rgba(255,255,255,0.18)' }),
      e('stop', { offset: '100%', stopColor: 'rgba(255,255,255,0)' }),
    ),
    // Tower RGB strip animated gradient
    e(
      'linearGradient',
      { id: 'sn-rgb', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
      e('stop', { offset: '0%', stopColor: '#A855F7' }),
      e('stop', { offset: '50%', stopColor: '#22D3EE' }),
      e('stop', { offset: '100%', stopColor: '#A78BFA' }),
    ),
    // Vent grid pattern for Linux server
    e(
      'pattern',
      {
        id: 'sn-vent',
        x: '0',
        y: '0',
        width: '4',
        height: '8',
        patternUnits: 'userSpaceOnUse',
      },
      e('rect', { x: '0', y: '0', width: '1.2', height: '8', fill: 'rgba(255,255,255,0.08)' }),
    ),
  )

  // ----- Floor reflection (under phone) -----
  const floor = e('ellipse', {
    cx: 300,
    cy: 510,
    rx: 150,
    ry: 14,
    fill: 'url(#sn-floor)',
    opacity: 0.7,
  })

  // ----- MacBook (top-left) -----
  const mac = e(
    'g',
    { transform: 'translate(30, 30)' },
    // Drop shadow
    e('rect', {
      x: 6,
      y: 8,
      width: 200,
      height: 130,
      rx: 9,
      fill: 'rgba(15,23,42,0.18)',
      filter: 'blur(8px)',
      opacity: 0.5,
    }),
    // Lid bezel
    e('rect', {
      x: 0,
      y: 0,
      width: 200,
      height: 130,
      rx: 9,
      fill: '#0E1320',
      stroke: 'rgba(255,255,255,0.10)',
      strokeWidth: 1,
    }),
    // Screen image (real desktop screenshot)
    e('image', {
      href: '/landing/privacy-preview.svg',
      x: 6,
      y: 6,
      width: 188,
      height: 118,
      preserveAspectRatio: 'xMidYMid slice',
      clipPath: 'inset(0 round 5px)',
    }),
    // Active wake overlay
    e('rect', {
      x: 6,
      y: 6,
      width: 188,
      height: 118,
      rx: 5,
      fill: 'url(#sn-screen-wake)',
      opacity: isMac ? 0.9 : 0,
      style: fade600,
    }),
    // Notch
    e('rect', { x: 88, y: 0, width: 24, height: 4, rx: 2, fill: '#000' }),
    // Hinge / base front edge
    e('path', {
      d: 'M -14 130 L 214 130 L 220 138 L -20 138 Z',
      fill: 'url(#sn-silver)',
      stroke: 'rgba(15,23,42,0.10)',
      strokeWidth: 0.5,
    }),
    // Trackpad cutout indicator (subtle)
    e('rect', {
      x: 70,
      y: 132,
      width: 60,
      height: 1.4,
      rx: 0.7,
      fill: 'rgba(15,23,42,0.18)',
    }),
    // Power LED (active indicator under hinge)
    e('circle', {
      cx: 100,
      cy: 144,
      r: 1.4,
      fill: '#22C55E',
      opacity: isMac ? 1 : 0.35,
      style: fade600,
    }),
  )

  // ----- Windows (top-center): monitor + tower -----
  const windowsRig = e(
    'g',
    { transform: 'translate(245, 8)' },
    // Monitor shadow
    e('rect', {
      x: 6,
      y: 8,
      width: 180,
      height: 110,
      rx: 8,
      fill: 'rgba(15,23,42,0.18)',
      filter: 'blur(8px)',
      opacity: 0.5,
    }),
    // Monitor bezel
    e('rect', {
      x: 0,
      y: 0,
      width: 180,
      height: 110,
      rx: 8,
      fill: '#0E1322',
      stroke: 'rgba(255,255,255,0.10)',
      strokeWidth: 1,
    }),
    // Screen background (panel)
    e('rect', {
      x: 6,
      y: 6,
      width: 168,
      height: 92,
      rx: 4,
      fill: '#1A2540',
    }),
    // Faux IDE: top tab bar
    e('rect', { x: 6, y: 6, width: 168, height: 9, rx: 4, fill: '#0F1A33' }),
    e('circle', { cx: 11, cy: 10.5, r: 1.4, fill: '#FF5F57', opacity: 0.6 }),
    e('circle', { cx: 16, cy: 10.5, r: 1.4, fill: '#FEBC2E', opacity: 0.6 }),
    e('circle', { cx: 21, cy: 10.5, r: 1.4, fill: '#28C840', opacity: 0.6 }),
    e('rect', { x: 56, y: 8, width: 36, height: 5, rx: 1, fill: 'rgba(255,255,255,0.08)' }),
    // Faux IDE: sidebar
    e('rect', { x: 6, y: 15, width: 30, height: 83, fill: 'rgba(0,0,0,0.18)' }),
    e('rect', { x: 9, y: 19, width: 24, height: 2, rx: 1, fill: 'rgba(255,255,255,0.18)' }),
    e('rect', { x: 9, y: 25, width: 18, height: 2, rx: 1, fill: 'rgba(255,255,255,0.10)' }),
    e('rect', { x: 9, y: 31, width: 22, height: 2, rx: 1, fill: 'rgba(255,255,255,0.10)' }),
    e('rect', { x: 9, y: 37, width: 14, height: 2, rx: 1, fill: 'rgba(255,255,255,0.10)' }),
    e('rect', { x: 9, y: 43, width: 20, height: 2, rx: 1, fill: 'rgba(255,255,255,0.10)' }),
    // Faux IDE: code lines
    e('rect', { x: 42, y: 22, width: 60, height: 2, rx: 1, fill: '#A78BFA' }),
    e('rect', { x: 42, y: 28, width: 90, height: 2, rx: 1, fill: 'rgba(255,255,255,0.55)' }),
    e('rect', { x: 50, y: 34, width: 70, height: 2, rx: 1, fill: 'rgba(255,255,255,0.4)' }),
    e('rect', { x: 50, y: 40, width: 100, height: 2, rx: 1, fill: '#5EEAD4' }),
    e('rect', { x: 50, y: 46, width: 56, height: 2, rx: 1, fill: 'rgba(255,255,255,0.35)' }),
    e('rect', { x: 42, y: 52, width: 78, height: 2, rx: 1, fill: 'rgba(255,255,255,0.45)' }),
    e('rect', { x: 50, y: 58, width: 90, height: 2, rx: 1, fill: 'rgba(255,255,255,0.3)' }),
    e('rect', { x: 50, y: 64, width: 64, height: 2, rx: 1, fill: 'rgba(255,255,255,0.3)' }),
    e('rect', { x: 42, y: 70, width: 110, height: 2, rx: 1, fill: 'rgba(255,255,255,0.45)' }),
    e('rect', { x: 50, y: 76, width: 80, height: 2, rx: 1, fill: '#A78BFA' }),
    e('rect', { x: 50, y: 82, width: 50, height: 2, rx: 1, fill: 'rgba(255,255,255,0.3)' }),
    // Active "typing caret"
    e(
      'rect',
      {
        x: 132,
        y: 76,
        width: 2,
        height: 5,
        fill: '#5EEAD4',
        opacity: isWin ? 1 : 0,
        style: fade600,
      },
      e('animate', {
        attributeName: 'opacity',
        values: '1;0.2;1',
        dur: '0.8s',
        repeatCount: 'indefinite',
      }),
    ),
    // Active wake overlay
    e('rect', {
      x: 6,
      y: 6,
      width: 168,
      height: 92,
      rx: 4,
      fill: 'url(#sn-screen-wake)',
      opacity: isWin ? 0.85 : 0,
      style: fade600,
    }),
    // Stand
    e('path', {
      d: 'M 80 110 L 100 110 L 106 134 L 74 134 Z',
      fill: '#3F4756',
    }),
    e('rect', { x: 60, y: 134, width: 60, height: 4, rx: 2, fill: '#3F4756' }),
    // Tower (right of monitor, slightly below)
    e(
      'g',
      { transform: 'translate(190, 64)' },
      // shadow
      e('rect', {
        x: 4,
        y: 6,
        width: 38,
        height: 80,
        rx: 5,
        fill: 'rgba(15,23,42,0.20)',
        filter: 'blur(6px)',
        opacity: 0.5,
      }),
      // chassis
      e('rect', {
        x: 0,
        y: 0,
        width: 38,
        height: 80,
        rx: 5,
        fill: '#15192A',
        stroke: 'rgba(255,255,255,0.10)',
        strokeWidth: 1,
      }),
      // Glass side panel hint
      e('rect', { x: 4, y: 4, width: 30, height: 60, rx: 3, fill: 'rgba(99,102,241,0.06)' }),
      // RGB strip
      e('rect', {
        x: 6,
        y: 6,
        width: 2.5,
        height: 56,
        rx: 1.25,
        fill: 'url(#sn-rgb)',
        opacity: isWin ? 1 : 0.55,
        style: fade600,
      }),
      // Power LED
      e('circle', {
        cx: 19,
        cy: 72,
        r: 1.6,
        fill: '#7BE5FF',
        opacity: isWin ? 1 : 0.35,
        style: fade600,
      }),
    ),
  )

  // ----- Linux 1U server (top-right) -----
  const linuxServer = e(
    'g',
    { transform: 'translate(412, 184)' },
    // Shadow
    e('rect', {
      x: 6,
      y: 8,
      width: 156,
      height: 50,
      rx: 5,
      fill: 'rgba(15,23,42,0.22)',
      filter: 'blur(8px)',
      opacity: 0.5,
    }),
    // Chassis
    e('rect', {
      x: 0,
      y: 0,
      width: 156,
      height: 50,
      rx: 5,
      fill: '#0F1117',
      stroke: 'rgba(255,255,255,0.10)',
      strokeWidth: 1,
    }),
    // Top highlight edge (machined metal feel)
    e('rect', {
      x: 0,
      y: 0,
      width: 156,
      height: 1.5,
      rx: 0.75,
      fill: 'rgba(255,255,255,0.08)',
    }),
    // Vent grid (left half)
    e('rect', {
      x: 8,
      y: 10,
      width: 50,
      height: 30,
      fill: 'url(#sn-vent)',
    }),
    // 1U grip handle
    e('rect', {
      x: 4,
      y: 18,
      width: 4,
      height: 14,
      rx: 1,
      fill: '#1F2433',
    }),
    // Bay separators (visual texture)
    e('line', {
      x1: 64,
      y1: 8,
      x2: 64,
      y2: 42,
      stroke: 'rgba(255,255,255,0.06)',
      strokeWidth: 1,
    }),
    e('line', {
      x1: 110,
      y1: 8,
      x2: 110,
      y2: 42,
      stroke: 'rgba(255,255,255,0.06)',
      strokeWidth: 1,
    }),
    // Status LEDs row
    e('circle', {
      cx: 70,
      cy: 14,
      r: 2,
      fill: '#22C55E',
      opacity: isLinux ? 1 : 0.55,
      style: fade600,
    }),
    e(
      'circle',
      { cx: 70, cy: 14, r: 2, fill: '#22C55E' },
      e('animate', {
        attributeName: 'opacity',
        values: isLinux ? '1;0.4;1' : '0.6;0.6;0.6',
        dur: isLinux ? '0.6s' : '2s',
        repeatCount: 'indefinite',
      }),
    ),
    e('circle', {
      cx: 78,
      cy: 14,
      r: 2,
      fill: '#FBBF24',
      opacity: isLinux ? 1 : 0.4,
      style: fade600,
    }),
    e('circle', {
      cx: 86,
      cy: 14,
      r: 2,
      fill: '#3B82F6',
      opacity: isLinux ? 1 : 0.4,
      style: fade600,
    }),
    e('circle', {
      cx: 94,
      cy: 14,
      r: 2,
      fill: '#EF4444',
      opacity: 0.35,
    }),
    // OLED hostname display
    e('rect', {
      x: 68,
      y: 24,
      width: 76,
      height: 16,
      rx: 1.5,
      fill: '#040608',
      stroke: 'rgba(255,255,255,0.08)',
      strokeWidth: 0.5,
    }),
    e(
      'text',
      {
        x: 72,
        y: 35,
        fontSize: 8,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontWeight: 600,
        fill: isLinux ? '#7BFFAA' : '#3FA56F',
        style: fade600,
      },
      'sn-hk-01 ',
      e(
        'tspan',
        { fill: isLinux ? '#A78BFA' : '#5C4F8A', style: fade600 },
        '●',
      ),
    ),
    // Power button
    e('circle', {
      cx: 148,
      cy: 14,
      r: 2.5,
      fill: '#1F2433',
      stroke: 'rgba(255,255,255,0.18)',
      strokeWidth: 0.6,
    }),
    e('circle', { cx: 148, cy: 14, r: 0.9, fill: '#22D3EE', opacity: 0.7 }),
    // RJ-45 / USB port hints (right side)
    e('rect', {
      x: 124,
      y: 28,
      width: 12,
      height: 7,
      rx: 0.6,
      fill: '#040608',
      stroke: 'rgba(255,255,255,0.10)',
      strokeWidth: 0.5,
    }),
    e('rect', {
      x: 138,
      y: 28,
      width: 12,
      height: 7,
      rx: 0.6,
      fill: '#040608',
      stroke: 'rgba(255,255,255,0.10)',
      strokeWidth: 0.5,
    }),
  )

  // ----- Light beams (one per machine) -----
  const beam = (
    id: string,
    d: string,
    active: boolean,
  ) =>
    e(
      'g',
      { opacity: active ? 1 : 0, style: fade600 },
      // Path itself (faint)
      e('path', {
        d,
        fill: 'none',
        stroke: 'url(#sn-beam)',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        opacity: 0.35,
      }),
      // Flowing dashed overlay
      e(
        'path',
        {
          id,
          d,
          fill: 'none',
          stroke: 'url(#sn-beam)',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
          strokeDasharray: '3 14',
        },
        e('animate', {
          attributeName: 'stroke-dashoffset',
          from: '0',
          to: '-34',
          dur: '0.9s',
          repeatCount: 'indefinite',
        }),
      ),
      // Two traveling glow dots
      e(
        'circle',
        { r: 3.4, fill: '#FFFFFF', filter: 'url(#sn-glow)' },
        e(
          'animateMotion',
          { dur: '1.4s', repeatCount: 'indefinite', rotate: 'auto' },
          e('mpath', { href: `#${id}` }),
        ),
      ),
      e(
        'circle',
        { r: 2.4, fill: '#A5B4FC', filter: 'url(#sn-glow)', opacity: 0.85 },
        e(
          'animateMotion',
          { dur: '1.4s', repeatCount: 'indefinite', begin: '0.7s', rotate: 'auto' },
          e('mpath', { href: `#${id}` }),
        ),
      ),
    )

  const beams = e(
    'g',
    null,
    beam('sn-beam-mac', beamMacPath, isMac),
    beam('sn-beam-win', beamWinPath, isWin),
    beam('sn-beam-linux', beamLinuxPath, isLinux),
  )

  // ----- Compose SVG -----
  const svg = e(
    'svg',
    {
      viewBox: '0 0 600 540',
      preserveAspectRatio: 'xMidYMid meet',
      width: '100%',
      height: '100%',
      'aria-hidden': 'true',
      style: {
        display: 'block',
        position: 'absolute',
        inset: 0,
        overflow: 'visible',
      },
    },
    defs,
    floor,
    mac,
    windowsRig,
    linuxServer,
    beams,
  )

  // ----- iPhone overlay (real screenshot in real frame) -----
  const phoneOverlay = (
    <View style={[s.orchestraPhone, compact && s.orchestraPhoneCompact]}>
      <View style={s.orchestraPhoneScreen}>
        {createElement('img', {
          src: '/landing/privacy-preview.svg',
          alt: t('screens_cap_machines'),
          loading: 'eager',
          decoding: 'async',
          fetchPriority: 'high',
          style: {
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            backgroundColor: C.white,
          },
        })}
        {/* Soft scan-line tint when active to imply "the phone is sending" */}
        <View
          pointerEvents="none"
          style={
            {
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'linear-gradient(180deg, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0) 35%)',
              opacity: phase === 'idle' ? 0 : 1,
              transition: 'opacity 600ms cubic-bezier(0.22, 1, 0.36, 1)',
            } as never
          }
        />
      </View>
      {/* Dispatch dot pulsing at top of phone */}
      <View
        pointerEvents="none"
        style={[s.orchestraDispatchDot, phase !== 'idle' && s.orchestraDispatchDotActive]}
        {...({
          className: phase !== 'idle' ? 'sn-dispatch-dot-active' : undefined,
        } as Record<string, unknown>)}
      />
    </View>
  )

  return (
    <View style={[s.orchestra, compact && s.orchestraCompact]}>
      {svg}
      {phoneOverlay}
    </View>
  )
}
