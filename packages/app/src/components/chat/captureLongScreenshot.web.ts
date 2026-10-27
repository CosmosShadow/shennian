import { normalizeCaptureBrandUrl } from './captureBranding'

export type LongScreenshotResult = {
  dataUrl: string
  width: number
  height: number
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function collectDocumentStyles(): string {
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) chunks.push(rule.cssText)
    } catch {
      // Cross-origin stylesheets cannot be read; chat styles are local.
    }
  }
  return chunks.join('\n')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image'))
    image.src = src
  })
}

function createCaptureBrandFooter(
  brandUrl: string,
  brandLogoDataUrl: string,
  brandQrSvg: string,
): HTMLDivElement {
  const brandHost = normalizeCaptureBrandUrl(brandUrl)
  const footer = document.createElement('div')
  footer.className = 'capture-brand-footer'
  footer.innerHTML =
    '<div class="capture-brand-lockup">' +
    `<img class="capture-brand-icon" src="${escapeHtml(brandLogoDataUrl)}" alt="" />` +
    '<div class="capture-brand-copy">' +
    '<div class="capture-brand-name">神念</div>' +
    '</div>' +
    '</div>' +
    '<div class="capture-brand-link">' +
    brandQrSvg +
    `<div class="capture-brand-url">${escapeHtml(brandHost)}</div>` +
    '</div>'
  return footer
}

export async function captureLongScreenshotFromElement(
  scrollRoot: HTMLDivElement | null,
  brandUrl: string,
  brandLogoDataUrl: string,
  brandQrSvg: string,
): Promise<LongScreenshotResult> {
  const messages = scrollRoot?.querySelector('.cwv-messages') as HTMLDivElement | null
  if (!scrollRoot || !messages || messages.children.length === 0) {
    throw new Error('empty')
  }

  const width = Math.ceil(scrollRoot.clientWidth || messages.scrollWidth || 1)
  const height = Math.ceil(messages.scrollHeight || messages.offsetHeight || 1)
  if (width <= 0 || height <= 0) throw new Error('empty')

  const footerHeight = 128
  const captureHeight = height + footerHeight
  const maxCanvasPixels = 32_000_000
  const deviceScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const scale = Math.min(deviceScale, Math.sqrt(maxCanvasPixels / (width * captureHeight)))

  const clone = messages.cloneNode(true) as HTMLDivElement
  clone.style.minHeight = '0'
  clone.style.width = `${width}px`
  clone.style.background = 'var(--bg)'
  const footer = createCaptureBrandFooter(brandUrl, brandLogoDataUrl, brandQrSvg)

  const wrapper = document.createElement('div')
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  wrapper.className = scrollRoot.className
  wrapper.style.cssText = scrollRoot.getAttribute('style') || ''
  wrapper.style.width = `${width}px`
  wrapper.style.minHeight = `${captureHeight}px`
  wrapper.style.overflow = 'visible'
  wrapper.style.background = 'var(--bg)'

  const style = document.createElement('style')
  style.textContent =
    collectDocumentStyles() +
    '\n.cwv{overflow:visible!important;height:auto!important;}.cwv-messages{min-height:0!important;}' +
    `.capture-brand-footer{box-sizing:border-box;height:${footerHeight}px;padding:14px 18px 15px;` +
    'border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;' +
    'gap:14px;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
    '.capture-brand-lockup{display:flex;align-items:center;gap:14px;min-width:0;}' +
    '.capture-brand-icon{width:54px;height:54px;border-radius:14px;flex:0 0 auto;display:block;}' +
    '.capture-brand-copy{min-width:0;}.capture-brand-name{font-size:20px;font-weight:700;line-height:25px;}' +
    '.capture-brand-slogan{font-size:14px;line-height:20px;color:var(--text-secondary);' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.capture-brand-link{display:flex;flex-direction:column;align-items:center;gap:4px;flex:0 0 auto;}' +
    '.capture-brand-qr{width:82px;height:82px;border-radius:6px;display:block;}' +
    '.capture-brand-url{font-size:10px;line-height:12px;color:var(--text-tertiary);white-space:nowrap;}'
  wrapper.append(style, clone, footer)

  const serialized = new XMLSerializer().serializeToString(wrapper)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${captureHeight}" viewBox="0 0 ${width} ${captureHeight}">` +
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width * scale))
  canvas.height = Math.max(1, Math.floor(captureHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.fillStyle = getComputedStyle(scrollRoot).getPropertyValue('--bg') || '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.drawImage(image, 0, 0)

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  }
}
