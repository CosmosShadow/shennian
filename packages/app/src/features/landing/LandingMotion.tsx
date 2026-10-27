// Web-only motion primitives for the marketing landing page.
//
// 1. <LandingMotionStyles /> — injects the page-wide keyframes (blob drift,
//    dispatch-dot pulse, card hover sweep) once. We use a single <style>
//    element instead of per-element CSS-in-JS so animations stay smooth
//    and are inspectable.
// 2. <Reveal /> — wraps a section/card and fades+slides it in when it enters
//    the viewport. Driven by IntersectionObserver, no external libs. Pure
//    one-shot reveal: once played, never re-plays (avoids "re-pop" thrash).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'

let injected = false

const KEYFRAMES = `
@keyframes sn-dispatch-pulse {
  0%, 100% { transform: translateX(-50%) scale(1); }
  50% { transform: translateX(-50%) scale(1.6); }
}
@keyframes sn-blob-1 {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(40px, 30px, 0) scale(1.05); }
}
@keyframes sn-blob-2 {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(-50px, 20px, 0) scale(0.95); }
}
@keyframes sn-blob-3 {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(20px, -25px, 0) scale(1.08); }
}
.sn-blob-drift-1 { animation: sn-blob-1 22s ease-in-out infinite; }
.sn-blob-drift-2 { animation: sn-blob-2 26s ease-in-out infinite; }
.sn-blob-drift-3 { animation: sn-blob-3 30s ease-in-out infinite; }

/* Pulsing dispatch dot at the iPhone top edge during a dispatch phase. */
.sn-dispatch-dot-active {
  animation: sn-dispatch-pulse 1.2s ease-in-out infinite;
}

/* Reveal: starts hidden, animates to visible when .sn-revealed is added. */
.sn-reveal {
  opacity: 0;
  transform: translate3d(0, 16px, 0);
  transition:
    opacity 700ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform;
}
.sn-revealed {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}
@media (prefers-reduced-motion: reduce) {
  .sn-blob-drift-1, .sn-blob-drift-2, .sn-blob-drift-3 { animation: none; }
  .sn-reveal { opacity: 1; transform: none; transition: none; }
}

/* Hover micro-interactions on feature cards and CTAs.
   We tag elements with sn-hover-* so plain RN <Pressable>/<View> don't
   need React-side onMouseEnter wiring. */
.sn-hover-card {
  transition:
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.sn-hover-card:hover {
  transform: translateY(-4px);
  /* !important to beat react-native-web's inline box-shadow on featureCard. */
  box-shadow:
    0 1px 0 rgba(255,255,255,0.7) inset,
    0 18px 40px rgba(99,102,241,0.14),
    0 36px 70px rgba(99,102,241,0.10) !important;
}
.sn-hover-card .sn-hover-screen {
  transition: transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.sn-hover-card:hover .sn-hover-screen {
  transform: scale(1.02);
}

/* Subtle highlight sweep across screen on hover. */
.sn-hover-screen::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(120deg,
    rgba(255,255,255,0) 30%,
    rgba(255,255,255,0.18) 50%,
    rgba(255,255,255,0) 70%);
  transform: translateX(-120%);
  transition: transform 800ms cubic-bezier(0.22, 1, 0.36, 1);
}
.sn-hover-card:hover .sn-hover-screen::after {
  transform: translateX(120%);
}

/* CTA hover lift. */
.sn-hover-cta-primary {
  transition:
    transform 200ms ease,
    box-shadow 200ms ease;
}
.sn-hover-cta-primary:hover {
  transform: translateY(-2px);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.35) inset,
    0 16px 36px rgba(99,102,241,0.40),
    0 4px 10px rgba(99,102,241,0.22);
}
.sn-hover-cta-secondary {
  transition:
    transform 200ms ease,
    box-shadow 200ms ease,
    background-color 200ms ease;
}
.sn-hover-cta-secondary:hover {
  transform: translateY(-2px);
  background-color: rgba(255,255,255,0.95) !important;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.7) inset,
    0 12px 28px rgba(15,23,42,0.10);
}

/* Nav CTA hover. */
.sn-hover-nav-cta {
  transition:
    transform 180ms ease,
    box-shadow 180ms ease;
}
.sn-hover-nav-cta:hover {
  transform: translateY(-1px);
  box-shadow:
    0 6px 18px rgba(99,102,241,0.45),
    0 1px 0 rgba(255,255,255,0.3) inset;
}

/* Logo pill hover (Works-with row). */
.sn-hover-pill {
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    background-color 180ms ease;
}
.sn-hover-pill:hover {
  transform: translateY(-2px);
  border-color: rgba(99,102,241,0.30);
  background-color: rgba(255,255,255,0.95);
}
`

export function LandingMotionStyles() {
  useEffect(() => {
    if (injected || typeof document === 'undefined') return
    const tag = document.createElement('style')
    tag.setAttribute('data-sn-landing', 'motion')
    tag.textContent = KEYFRAMES
    document.head.appendChild(tag)
    injected = true
    return () => {
      // Keep the style tag mounted for the rest of the SPA session — the
      // landing page is the only consumer and the rules are name-spaced.
    }
  }, [])
  return null
}

// IntersectionObserver-backed reveal. Once an element has crossed the
// threshold it's marked revealed and the observer detaches.
export function Reveal({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode
  delay?: number
  style?: object
}) {
  const ref = useRef<View>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const node = ref.current as unknown as Element | null
    if (!node) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true)
            obs.disconnect()
            break
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' },
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [])

  // Delay applied via inline transition-delay so we don't multiply timers.
  const composed = useMemo(
    () => ({
      ...(style || {}),
      ...(delay
        ? ({
            transitionDelay: `${delay}ms`,
          } as object)
        : {}),
    }),
    [style, delay],
  )

  return (
    <View
      ref={ref}
      style={composed as never}
      // @ts-expect-error className is a valid web prop on react-native-web View
      className={shown ? 'sn-reveal sn-revealed' : 'sn-reveal'}
    >
      {children}
    </View>
  )
}
