/**
 * 扩展导出引擎页 —— 复用 MarkDoc 网页版核心的唯一直通管线：
 *
 *   导出任务(chrome.storage) → renderPreviewDom（core/previewDom，KaTeX+Mermaid）
 *   → target-aware preflight（core/preflight）
 *   → buildDocxBlob（core/exporter）或 buildPdf（core/pdf/export）
 *   → 下载（网页 filename helper 统一命名）
 *
 * 不重新实现任何 Markdown/公式/Word/PDF 逻辑。
 */

import './exporter.css'
import { renderPreviewDom } from '../src/core/previewDom'
import { resolveTemplateBase, cssVarsFor, normalizeDocSettings } from '../src/core/templates'
import { runPreflight, type PreflightResult } from '../src/core/preflight'
import { buildDocxBlob } from '../src/core/exporter'
import { buildPdf, PdfExportError } from '../src/core/pdf/export'
import { buildExportFilename } from '../src/core/filename'
import { accountEnabled, requestExportTicket, signIn, type TicketResult } from '../src/core/account'
import { takeExportJob, stageImport, loadQuickSettings, recordExportResult } from './src/storage'
import { MarkDocExtError } from './src/errors'
import type { ExportJob } from './src/types'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const MODE_LABEL: Record<string, string> = {
  answer: '单条回答',
  qa: '问答',
  selection: '多选消息',
  conversation: '整段对话',
}

const TARGET_LABEL = { docx: 'Word', pdf: 'PDF' } as const

let currentJob: ExportJob | null = null
let pendingTarget: 'docx' | 'pdf' = 'docx'
let lastPreflight: PreflightResult | null = null
let currentContainer: HTMLElement | null = null

function showView(name: 'stage' | 'preflight' | 'progress' | 'done' | 'error') {
  // 舞台（stage-view / preview-container）常驻可见：html2canvas 截图与
  // PDF 布局实测都要求源元素处于渲染状态；这里只切换覆盖层卡片。
  $('overlay').classList.toggle('hidden', name === 'stage')
  for (const id of ['preflight-view', 'progress-view', 'done-view', 'error-view']) {
    $(id).classList.toggle('hidden', id !== `${name}-view`)
  }
}

function setProgress(pct: number, label?: string) {
  $('progress-fill').style.width = `${Math.min(100, Math.max(0, pct))}%`
  if (label) $('progress-label').textContent = label
}

/** 下载 Blob（扩展页面内 anchor 直接触发，无需额外权限） */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** 渲染预览舞台（与网页预览同构：md-preview + 模板类 + 纸张类 + CSS 变量） */
async function renderStage(job: ExportJob): Promise<HTMLElement> {
  const settings = job.settings
  const base = resolveTemplateBase(settings.template)
  const container = $('preview-container')
  container.className = `md-preview tpl-${base.id} a4-page`
  const vars = cssVarsFor(settings)
  for (const [k, v] of Object.entries(vars)) container.style.setProperty(k, v)
  // 页边距：纸张视图的 padding 由 --pd-page-pad 提供（与网页一致）

  await renderPreviewDom(container, job.markdown, settings)
  return container
}

/** 渲染后运行 target-aware preflight */
function preflight(job: ExportJob, containerHtml: string, target: 'docx' | 'pdf'): PreflightResult {
  return runPreflight(job.markdown, containerHtml, target)
}

function showPreflight(job: ExportJob, result: PreflightResult, target: 'docx' | 'pdf') {
  lastPreflight = result
  const statsEl = $('preflight-stats')
  const { stats } = result
  statsEl.innerHTML = ''
  const items = [
    `${MODE_LABEL[job.mode] ?? '文档'} · ${stats.headings} 标题`,
    `${stats.math} 公式`,
    `${stats.tables} 表格`,
    `${stats.images} 图片`,
    `${stats.codeBlocks} 代码块`,
    `${stats.chars} 字符`,
  ]
  for (const text of items) {
    const span = document.createElement('span')
    span.textContent = text
    statsEl.appendChild(span)
  }

  const list = $('preflight-issues')
  list.innerHTML = ''
  for (const issue of result.issues) {
    const li = document.createElement('li')
    li.className = issue.level
    li.textContent = `${issue.level === 'error' ? '🔴' : '🟡'} ${issue.message}`
    list.appendChild(li)
  }
  if (result.issues.length === 0) {
    const li = document.createElement('li')
    li.className = 'warn'
    li.textContent = '✅ 未发现问题，可直接导出'
    list.appendChild(li)
  }
  void target
  showView('preflight')
}

/** 在 MarkDoc 网页版中打开（复用扩展临时导入桥，30 分钟 TTL） */
async function openInMarkDoc(job: ExportJob): Promise<void> {
  const importId = await stageImport({
    markdown: job.markdown,
    documentTitle: job.documentTitle,
    platform: job.platform,
    sourceUrl: job.sourceUrl,
  })
  const quick = await loadQuickSettings()
  await chrome.runtime.sendMessage({
    type: 'MARKDOC_OPEN_EDITOR',
    importId,
    markdocUrl: quick.markdocUrl,
  })
  window.close()
}

/** 配额拦截 → 内联登录表单（账号与网站通用；注册引导跳网站 ?auth=register） */
async function showQuotaLogin(res: Extract<TicketResult, { ok: false }>): Promise<void> {
  const wrap = $('quota-login')
  const msg = $('quota-msg')
  msg.hidden = true
  msg.textContent = ''
  wrap.classList.remove('hidden')
  $('error-detail').textContent = res.message
  showView('error')
  try {
    const quick = await loadQuickSettings()
    ;($('quota-register-link') as HTMLAnchorElement).href = `${quick.markdocUrl.replace(/\/$/, '')}?auth=register`
  } catch { /* 取不到设置就用默认链接 */ }
  const btn = $('btn-quota-login') as HTMLButtonElement
  btn.onclick = async () => {
    const email = ($('quota-email') as HTMLInputElement).value.trim()
    const password = ($('quota-password') as HTMLInputElement).value
    msg.hidden = false
    msg.textContent = '登录中…'
    btn.disabled = true
    const r = await signIn(email, password)
    btn.disabled = false
    if (!r.ok) {
      msg.textContent = r.message
      return
    }
    wrap.classList.add('hidden')
    const job = currentJob
    const container = currentContainer
    if (job && container) void runExport(job, pendingTarget, container)
  }
}

async function runExport(job: ExportJob, target: 'docx' | 'pdf', container: HTMLElement): Promise<void> {
  currentContainer = container
  pendingTarget = target
  // ── 配额执法点：与网站同一套服务端计次（匿名免费 1 次 + 同 IP 日限额）──
  if (accountEnabled) {
    showView('progress')
    setProgress(2, '正在校验使用配额…')
    const res = await requestExportTicket(target, { source: 'extension' })
    if (!res.ok) {
      await recordExportResult({ target, ok: false, errorCode: 'MD-EXT-011', at: Date.now() })
      if (res.reason === 'QUOTA_EXCEEDED' || res.reason === 'AUTH_REQUIRED') {
        await showQuotaLogin(res)
      } else {
        $('quota-login').classList.add('hidden')
        $('error-detail').textContent = res.message || '网络错误，请稍后重试'
        showView('error')
      }
      return
    }
  }
  showView('progress')
  setProgress(2, target === 'docx' ? '正在生成 Word…' : '正在准备内容…')
  const filename = `${buildExportFilename(job.markdown, job.documentTitle)}`
  try {
    if (target === 'docx') {
      setProgress(30, '正在生成 Word（公式转 OMML）…')
      const blob = await buildDocxBlob(container.innerHTML, { settings: job.settings })
      setProgress(96, '正在保存…')
      downloadBlob(blob, `${filename}.docx`)
    } else {
      const result = await buildPdf(container, job.settings, {
        onProgress: (pct, label) => setProgress(pct, label),
      })
      downloadBlob(result.blob, `${filename}.pdf`)
      await recordExportResult({ target: 'pdf', ok: true, at: Date.now() })
      $('done-detail').textContent = `${filename}.pdf · ${result.pages} 页 · ${(result.durationMs / 1000).toFixed(1)}s${
        result.notices.length > 0 ? `\n${result.notices.slice(0, 3).join('\n')}` : ''
      }`
      showView('done')
      setTimeout(() => window.close(), 2500)
      return
    }
    await recordExportResult({ target: 'docx', ok: true, at: Date.now() })
    $('done-detail').textContent = `${filename}.docx（公式可在 Word 中直接编辑）`
    showView('done')
    setTimeout(() => window.close(), 2000)
  } catch (err) {
    const code: 'MD-EXT-006' | 'MD-EXT-007' = target === 'docx' ? 'MD-EXT-006' : 'MD-EXT-007'
    await recordExportResult({ target, ok: false, errorCode: code, at: Date.now() })
    if (err instanceof PdfExportError) {
      $('error-detail').textContent = `${err.message}\n${err.details.slice(0, 4).join('\n')}`
    } else if (err instanceof MarkDocExtError) {
      $('error-detail').textContent = err.userMessage
    } else {
      $('error-detail').textContent = `${err instanceof Error ? err.message : String(err)}\n（${code}）`
    }
    console.error('[MarkDoc] export failed', err)
    showView('error')
  }
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const jobId = params.get('job')
  if (!jobId) {
    $('error-detail').textContent = '缺少导出任务参数。请从 AI 页面的 MarkDoc 按钮 / 扩展弹窗发起导出。'
    showView('error')
    return
  }
  const raw = await takeExportJob(jobId)
  if (!raw) {
    $('error-detail').textContent = '导出任务不存在或已过期，请回到 AI 页面重新发起导出。'
    showView('error')
    return
  }
  const job: ExportJob = { ...raw, settings: normalizeDocSettings(raw.settings) }
  currentJob = job

  $('mode-label').textContent = `${MODE_LABEL[job.mode] ?? '文档'} · ${job.platform}`
  const meta = $('job-meta')
  const s = job.stats
  meta.textContent = [
    `《${job.documentTitle}》`,
    `消息 ${s.messages} 条（用户 ${s.userMessages} / AI ${s.assistantMessages}）`,
    `公式 ${s.formulas} · 表格 ${s.tables} · 图片 ${s.images} · 代码块 ${s.codeBlocks + s.mermaidBlocks}`,
  ].join('　·　')

  // 渲染舞台（KaTeX + Mermaid 完成后）
  showView('stage')
  const container = await renderStage(job)

  const guard = async (target: 'docx' | 'pdf') => {
    // 先记录目标：preflight「继续导出」路径依赖 pendingTarget（此前默认 docx，
    // 会导致 PDF 任务经 preflight 确认后错导 Word —— E2E 一致性用例捕获）
    pendingTarget = target
    // target-aware preflight（规范二十五节）：有问题不阻断，给出继续/修复
    const result = preflight(job, container.innerHTML, target)
    if (result.issues.length > 0) showPreflight(job, result, target)
    else await runExport(job, target, container)
  }

  $('btn-docx').addEventListener('click', () => void guard('docx'))
  $('btn-pdf').addEventListener('click', () => void guard('pdf'))
  $('btn-edit').addEventListener('click', () => void openInMarkDoc(job))

  $('btn-preflight-continue').addEventListener('click', () => {
    if (currentJob) void runExport(currentJob, pendingTarget, container)
  })
  $('btn-preflight-fix').addEventListener('click', () => {
    if (currentJob) void openInMarkDoc(currentJob)
  })

  $('btn-close').addEventListener('click', () => window.close())
  $('btn-error-close').addEventListener('click', () => window.close())

  // 自动按用户所选目标开始导出（选择即导出，几秒内拿到文件；
  // preflight 有问题时暂停，等待用户「继续导出 / 在 MarkDoc 中修复」）
  await guard(job.target)
}

void boot()
