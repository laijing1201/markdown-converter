/**
 * Background service worker（MV3）：
 *   - 打开导出引擎页（exporter.html?job=<id>）
 *   - 打开 MarkDoc 网页版（「在 MarkDoc 中编辑」桥接）
 *   - 「在 MarkDoc 中编辑」临时导入读取（一次性消费 + 30 分钟过期）
 *   - 快捷键 Alt+Shift+W：导出最近回答（默认格式）
 *
 * 权限最小化：只用 storage；不申请 tabs/history/cookies/scripting。
 */

import { loadQuickSettings, sweepExpiredData, takeImport } from '../storage'

chrome.runtime.onInstalled.addListener((details) => {
  void sweepExpiredData()
  // 首次安装：打开轻量引导页（P4C 第三十三节；升级安装不打扰）
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
  }
})
chrome.runtime.onStartup.addListener(() => {
  void sweepExpiredData()
})

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request?.type) {
    case 'MARKDOC_OPEN_EXPORTER': {
      const url = chrome.runtime.getURL(`exporter.html?job=${encodeURIComponent(request.jobId)}`)
      chrome.tabs.create({ url })
      sendResponse({ opened: true })
      return false
    }

    case 'MARKDOC_OPEN_EDITOR': {
      void (async () => {
        const quick = await loadQuickSettings()
        const base = request.markdocUrl || quick.markdocUrl
        const url = `${base.replace(/\/+$/, '')}/#ext-import=${encodeURIComponent(request.importId)}`
        chrome.tabs.create({ url })
        sendResponse({ opened: true })
      })()
      return true
    }

    case 'EXT_GET_IMPORT': {
      void (async () => {
        const payload = await takeImport(request.id)
        sendResponse({ payload: payload ?? null })
      })()
      return true
    }

    default:
      return false
  }
})

// ── 快捷键：Alt+Shift+W 导出最近回答 ─────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'export-last-answer') return
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const quick = await loadQuickSettings()
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'MARKDOC_EXPORT_LAST', target: quick.defaultTarget })
    } catch {
      // 未识别平台 / 未注入 content script：轻量提示，不报错（规范二十七节）
      console.info('[MarkDoc] 当前页面不支持快速导出')
    }
  })()
})
