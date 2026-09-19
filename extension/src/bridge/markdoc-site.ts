/**
 * MarkDoc 网页版桥接 content script：
 *
 *   扩展 background 保存临时导入（30 分钟 TTL，一次性消费）
 *   → 打开 MarkDoc 网站（#ext-import=<id>）
 *   → 网页 App 向 window postMessage 请求
 *   → 本桥转发给 background（chrome.runtime.sendMessage）
 *   → background 返回内容 → 本桥 postMessage 回网页
 *
 * 安全：只响应同源（location.origin）窗口消息；内容只经 chrome.runtime
 * 内部通道传输，不落到任何页面可枚举的全局变量上。
 */

const SOURCE_WEB = 'markdoc-web'
const SOURCE_EXT = 'markdoc-ext'

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return
  if (event.origin !== location.origin) return
  const data = event.data as { source?: string; type?: string; id?: string } | null
  if (!data || data.source !== SOURCE_WEB || data.type !== 'EXT_IMPORT_REQUEST' || !data.id) return

  void chrome.runtime
    .sendMessage({ type: 'EXT_GET_IMPORT', id: data.id })
    .then((response: { payload: unknown } | undefined) => {
      window.postMessage(
        {
          source: SOURCE_EXT,
          type: 'EXT_IMPORT_CONTENT',
          id: data.id,
          payload: response?.payload ?? null,
        },
        location.origin,
      )
    })
    .catch(() => {
      window.postMessage({ source: SOURCE_EXT, type: 'EXT_IMPORT_CONTENT', id: data.id, payload: null }, location.origin)
    })
})
