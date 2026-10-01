import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA：仅生产环境 Web 端注册 Service Worker。
// Electron（file://）与 Capacitor 安卓壳内跳过：壳自带全部资源，SW 反而会干扰更新。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  const isNativeApp = typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()
  if (!isNativeApp && window.location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[MarkDoc] Service Worker 注册失败（不影响正常使用）', err)
      })
    })
  }
}
