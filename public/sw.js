/**
 * MarkDoc Service Worker（PWA / 安卓「添加到主屏幕」离线壳）
 *
 * 策略（与项目字体/缓存管线分工，互不干扰）：
 *  - 页面导航：network-first，断网回退缓存壳（index.html）
 *  - 同源静态资源（Vite 带哈希的 js/css/woff/svg…）：stale-while-revalidate
 *  - 字体（/fonts/）：跳过——应用内已有 Cache API 跨会话缓存，SW 不重复存
 *  - 跨域（Supabase 等）：一律直连，绝不缓存
 *
 * 更新方式：index.html / 静态资源均为网络优先或 SWR，发版后第二次打开即拿到新版。
 */

const VERSION = 'v1.2.0-4'
const CACHE_NAME = `markdoc-${VERSION}`
const PRECACHE = ['./', './index.html', './manifest.webmanifest']

/** 命中即绕过 SW（不读也不写缓存） */
function shouldBypass(url) {
  if (url.origin !== self.location.origin) return true
  // 应用自管缓存的字体；Supabase Edge Functions 同源反代场景兜底
  return url.pathname.includes('/fonts/') || url.pathname.includes('/functions/')
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => /^markdoc-v\d/.test(k) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (shouldBypass(url)) return

  // 页面导航：网络优先，断网回退离线壳。
  // 只缓存 2xx 的 HTML——曾经无脑 cache.put 会把网关错误页（404/502…）写进
  // 缓存，之后断网/回退时用户看到的永远是那张错误页（「打开没渲染」的一类根因）。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(req, copy))
          } else {
            // 网络给了错误页：尝试用缓存里的好壳替代，避免白屏/错误页直接糊脸
            return caches.match(req).then((hit) => hit ?? caches.match('./index.html').then((h) => h ?? res))
          }
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match('./index.html'))),
    )
    return
  }

  // 同源静态资源：SWR（先回缓存，后台刷新）
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone())
          return res
        })
        .catch(() => cached)
      return cached ?? network
    }),
  )
})
