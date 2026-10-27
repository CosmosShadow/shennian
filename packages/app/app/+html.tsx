import { ScrollViewStyleReset } from 'expo-router/html'
import type { PropsWithChildren } from 'react'

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)" />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body { margin: 0; overflow: hidden; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
              #root { display: flex; flex: 1; height: 100vh; height: 100dvh; }
              [data-desktop-drag='true'], [data-testid='desktop-sidebar-chrome'] {
                -webkit-app-region: drag;
                app-region: drag;
                user-select: none;
              }
              :is([data-desktop-drag='true'], [data-testid='desktop-sidebar-chrome']) :is(button, a, input, select, textarea, [role='button'], [role='menu'], [role='menuitem'], [tabindex]) {
                -webkit-app-region: no-drag;
                app-region: no-drag;
              }
              input, textarea, select { font-family: inherit; }
              [data-desktop-drag='false'], [role='tab'] { -webkit-app-region: no-drag; }
              :where(a, button, input, textarea, select, [role='button'], [role='link'], [tabindex]):focus-visible {
                outline: 2px solid Highlight !important;
                outline-offset: 2px !important;
              }
              @media (forced-colors: none) {
                [data-testid='desktop-chat-composer'] [data-testid='chat-input']:focus,
                #desktop-room-message-input:focus,
                [data-testid='scoped-room-message-input']:focus {
                  outline: none !important;
                }
              }
              @media (prefers-reduced-motion: reduce) {
                *, *::before, *::after {
                  animation-duration: 0.01ms !important;
                  animation-iteration-count: 1 !important;
                  scroll-behavior: auto !important;
                  transition-duration: 0.01ms !important;
                }
              }
              @media (forced-colors: active) {
                body {
                  color: CanvasText;
                  background: Canvas;
                }
                *, *::before, *::after {
                  box-shadow: none !important;
                  text-shadow: none !important;
                }
                :where(a, button, input, textarea, select, [role='button'], [role='link'], [tabindex]) {
                  forced-color-adjust: auto;
                }
                :where([role='button'], button, input, textarea, select):focus-visible {
                  outline-color: Highlight !important;
                }
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
