/**
 * Content script 注入 UI —— 全部位于单一 Shadow DOM 宿主内。
 *
 * 隔离原则（规范第七节）：
 *   - 页面 DOM 只增加一个 <div data-markdoc-root>，内部渲染在 closed shadow root；
 *   - 所有 class 以 markdoc- 前缀命名，不写任何全局 element 选择器；
 *   - 不修改 AI 网站的字体/间距/布局/颜色/按钮；
 *   - 深浅色跟随系统 + 页面背景亮度采样。
 */

import type { ChatMessage } from '../types'

export type UIMenuItem = { label: string; icon?: string; onClick: () => void; danger?: boolean } | 'separator'

const Z_MAX = 2147483647

export class ChatUI {
  private host: HTMLDivElement
  private shadow: ShadowRoot
  /** 每条消息的悬浮元素（按钮/复选框），key = 元素 */
  private messageButtons = new Map<HTMLElement, HTMLDivElement>()
  private selectionBoxes = new Map<HTMLElement, HTMLLabelElement>()
  private selection = new Set<HTMLElement>()
  private selectionMode = false
  private onSelectionChange?: (selected: HTMLElement[]) => void
  private onMessageAction?: (msg: ChatMessage, element: HTMLElement) => void
  /** 多选模式下复选框点击的回调 */
  private onSelectToggle?: (element: HTMLElement, selected: boolean) => void
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private rafPending = false

  constructor() {
    this.host = document.createElement('div')
    this.host.setAttribute('data-markdoc-root', '')
    this.host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;all:initial;'
    document.documentElement.appendChild(this.host)
    this.shadow = this.host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = this.css()
    this.shadow.appendChild(style)

    // 滚动/尺寸变化时重定位悬浮元素
    window.addEventListener('scroll', this.scheduleReposition, { capture: true, passive: true })
    window.addEventListener('resize', this.scheduleReposition, { passive: true })
  }

  // ── 主题 ──────────────────────────────────────────────────────────────────

  private isDark(): boolean {
    try {
      const bg = getComputedStyle(document.body).backgroundColor
      const m = bg.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
      if (m) {
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        if (lum < 0.4) return true
        if (lum > 0.7) return false
      }
    } catch { /* ignore */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  private vars(): string {
    const dark = this.isDark()
    return [
      `--md-bg:${dark ? '#1f2937' : '#ffffff'}`,
      `--md-bg-soft:${dark ? '#111827' : '#f9fafb'}`,
      `--md-fg:${dark ? '#f3f4f6' : '#111827'}`,
      `--md-fg-soft:${dark ? '#9ca3af' : '#6b7280'}`,
      `--md-border:${dark ? '#374151' : '#e5e7eb'}`,
      `--md-accent:${dark ? '#60a5fa' : '#2563eb'}`,
      `--md-shadow:${dark ? '0 4px 16px rgba(0,0,0,.5)' : '0 4px 16px rgba(0,0,0,.12)'}`,
    ].join(';')
  }

  private css(): string {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
      .markdoc-float {
        position: fixed; z-index: ${Z_MAX}; pointer-events: auto;
        opacity: 0; transition: opacity .15s ease; will-change: transform;
      }
      .markdoc-float.markdoc-visible { opacity: 1; }

      /* 单条消息导出按钮 */
      .markdoc-msg-btn {
        width: 30px; height: 30px; border-radius: 8px;
        background: var(--md-bg); color: var(--md-accent);
        border: 1px solid var(--md-border); box-shadow: var(--md-shadow);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; font-size: 15px; user-select: none;
      }
      .markdoc-msg-btn:hover { border-color: var(--md-accent); transform: scale(1.05); }

      /* 多选复选框 */
      .markdoc-checkbox {
        width: 22px; height: 22px; border-radius: 6px;
        background: var(--md-bg); border: 1.5px solid var(--md-border);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; user-select: none; font-size: 13px; color: transparent;
      }
      .markdoc-checkbox.markdoc-checked {
        background: var(--md-accent); border-color: var(--md-accent); color: #fff;
      }

      /* 菜单 */
      .markdoc-menu {
        position: fixed; z-index: ${Z_MAX}; min-width: 180px;
        background: var(--md-bg); border: 1px solid var(--md-border);
        border-radius: 10px; box-shadow: var(--md-shadow); padding: 6px;
        pointer-events: auto;
      }
      .markdoc-menu-item {
        display: flex; align-items: center; gap: 8px; width: 100%;
        padding: 8px 10px; border: none; background: transparent;
        color: var(--md-fg); font-size: 13px; border-radius: 6px; cursor: pointer; text-align: left;
      }
      .markdoc-menu-item:hover { background: var(--md-bg-soft); }
      .markdoc-menu-item.markdoc-danger { color: #ef4444; }
      .markdoc-menu-sep { height: 1px; background: var(--md-border); margin: 4px 6px; }
      .markdoc-menu-title { padding: 6px 10px 2px; font-size: 11px; color: var(--md-fg-soft); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* 悬浮球 */
      .markdoc-launcher {
        position: fixed; z-index: ${Z_MAX}; right: 18px; bottom: 18px;
        width: 44px; height: 44px; border-radius: 50%;
        background: var(--md-accent); color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; cursor: pointer; box-shadow: var(--md-shadow);
        border: none; pointer-events: auto; user-select: none;
      }
      .markdoc-launcher:hover { transform: scale(1.08); }

      /* 多选工具条 */
      .markdoc-selection-bar {
        position: fixed; z-index: ${Z_MAX}; left: 50%; transform: translateX(-50%);
        bottom: 20px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        background: var(--md-bg); border: 1px solid var(--md-border);
        border-radius: 12px; box-shadow: var(--md-shadow); padding: 8px 12px;
        pointer-events: auto; max-width: 92vw;
      }
      .markdoc-selection-count { font-size: 13px; font-weight: 600; color: var(--md-fg); }
      .markdoc-btn {
        padding: 6px 12px; border-radius: 8px; font-size: 12.5px; cursor: pointer;
        border: 1px solid var(--md-border); background: var(--md-bg);
        color: var(--md-fg); white-space: nowrap;
      }
      .markdoc-btn:hover { border-color: var(--md-accent); color: var(--md-accent); }
      .markdoc-btn.markdoc-primary { background: var(--md-accent); border-color: var(--md-accent); color: #fff; }
      .markdoc-btn.markdoc-primary:hover { opacity: .9; color: #fff; }
      .markdoc-btn:disabled { opacity: .45; cursor: not-allowed; }

      /* 弹窗（流式确认/错误） */
      .markdoc-dialog-mask {
        position: fixed; inset: 0; z-index: ${Z_MAX};
        background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center;
        pointer-events: auto;
      }
      .markdoc-dialog {
        width: 340px; max-width: 90vw; background: var(--md-bg);
        border: 1px solid var(--md-border); border-radius: 14px;
        box-shadow: var(--md-shadow); padding: 20px;
      }
      .markdoc-dialog h3 { font-size: 15px; color: var(--md-fg); margin-bottom: 8px; }
      .markdoc-dialog p { font-size: 13px; color: var(--md-fg-soft); line-height: 1.6; margin-bottom: 16px; word-break: break-all; }
      .markdoc-dialog-actions { display: flex; gap: 8px; justify-content: flex-end; }

      /* Toast */
      .markdoc-toast {
        position: fixed; z-index: ${Z_MAX}; left: 50%; transform: translateX(-50%);
        top: 24px; background: var(--md-bg); color: var(--md-fg);
        border: 1px solid var(--md-border); border-radius: 10px;
        box-shadow: var(--md-shadow); padding: 10px 16px; font-size: 13px;
        pointer-events: auto; max-width: 80vw; text-align: center;
      }
      .markdoc-hidden { display: none !important; }
    `
  }

  // ── 通用元素构建 ──────────────────────────────────────────────────────────

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    parent?: HTMLElement,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    node.className = className
    // 主题变量挂在每个组件根上（shadow 内无全局继承问题）
    node.setAttribute('style', this.vars())
    parent?.appendChild(node)
    return node
  }

  private makeMenuItem(label: string, icon: string, onClick: () => void, danger = false): HTMLButtonElement {
    const btn = this.el('button', 'markdoc-menu-item' + (danger ? ' markdoc-danger' : ''))
    btn.innerHTML = `<span>${icon}</span><span>${label}</span>`
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.closeMenus()
      onClick()
    })
    return btn
  }

  // ── 悬浮球 + 主菜单 ───────────────────────────────────────────────────────

  showLauncher(onOpenMenu: () => void): void {
    if (this.shadow.querySelector('.markdoc-launcher')) return
    const launcher = this.el('button', 'markdoc-launcher')
    launcher.title = 'MarkDoc：导出为 Word / PDF'
    launcher.textContent = '📄'
    launcher.addEventListener('click', (e) => {
      e.stopPropagation()
      onOpenMenu()
    })
    this.shadow.appendChild(launcher)
  }

  showLauncherMenu(items: UIMenuItem[], title?: string): void {
    this.closeMenus()
    const menu = this.el('div', 'markdoc-menu')
    menu.style.right = '18px'
    menu.style.bottom = '70px'
    if (title) {
      const t = this.el('div', 'markdoc-menu-title', menu)
      t.textContent = title
    }
    for (const item of items) {
      if (item === 'separator') {
        this.el('div', 'markdoc-menu-sep', menu)
      } else {
        menu.appendChild(this.makeMenuItem(item.label, item.icon ?? '', item.onClick, item.danger))
      }
    }
    this.shadow.appendChild(menu)
    setTimeout(() => {
      document.addEventListener('click', this.globalCloseOnce, { capture: true, once: true })
    }, 0)
  }

  // ── 单条消息悬浮按钮 ──────────────────────────────────────────────────────

  attachMessageButton(
    element: HTMLElement,
    onClick: (el: HTMLElement) => void,
  ): void {
    if (this.messageButtons.has(element)) return
    const btn = this.el('div', 'markdoc-msg-btn markdoc-float')
    btn.textContent = '📄'
    btn.title = 'MarkDoc：导出这条回答'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      onClick(element)
    })
    this.messageButtons.set(element, btn)
    this.shadow.appendChild(btn)
    this.positionFor(btn, element, 'right')
  }

  /** 流式生成中的按钮状态（P4C 第十一节：生成中显示 ⏳，不重复注入按钮） */
  setMessageStreaming(element: HTMLElement, streaming: boolean): void {
    const btn = this.messageButtons.get(element)
    if (!btn) return
    btn.textContent = streaming ? '⏳' : '📄'
    btn.title = streaming
      ? 'MarkDoc：该回答仍在生成，点击可选择导出当前内容'
      : 'MarkDoc：导出这条回答'
  }

  /** 消息 hover 时显示对应按钮（mouseenter 由页面侧 mouseover 委托触发） */
  handleHover(target: EventTarget | null): void {
    if (this.selectionMode) return
    for (const [element, btn] of this.messageButtons) {
      if (element === target || (target instanceof Node && element.contains(target))) {
        btn.classList.add('markdoc-visible')
        this.positionFor(btn, element, 'right')
      } else {
        btn.classList.remove('markdoc-visible')
      }
    }
  }

  // ── 多选模式 ──────────────────────────────────────────────────────────────

  enterSelectionMode(
    elements: HTMLElement[],
    selectedOnInit: Set<HTMLElement>,
    handlers: {
      onToggle: (element: HTMLElement, selected: boolean) => void
      onChange: (selected: HTMLElement[]) => void
    },
  ): void {
    this.exitSelectionMode()
    this.selectionMode = true
    this.selection = new Set(selectedOnInit)
    this.onSelectToggle = handlers.onToggle
    this.onSelectionChange = handlers.onChange

    for (const element of elements) {
      const box = this.el('label', 'markdoc-checkbox markdoc-float markdoc-visible')
      box.textContent = '✓'
      if (this.selection.has(element)) box.classList.add('markdoc-checked')
      box.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
        const checked = !this.selection.has(element)
        if (checked) this.selection.add(element)
        else this.selection.delete(element)
        box.classList.toggle('markdoc-checked', checked)
        this.onSelectToggle?.(element, checked)
        this.onSelectionChange?.(this.getSelectedInOrder())
      })
      this.selectionBoxes.set(element, box)
      this.shadow.appendChild(box)
      this.positionFor(box, element, 'left')
    }
  }

  exitSelectionMode(): void {
    for (const box of this.selectionBoxes.values()) box.remove()
    this.selectionBoxes.clear()
    this.selection.clear()
    this.selectionMode = false
    this.closeSelectionBar()
  }

  isSelectionMode(): boolean {
    return this.selectionMode
  }

  /** 编程式设置某条消息的选中态（全选/只选用户等批量操作用） */
  selectMessage(element: HTMLElement, selected: boolean): void {
    if (!this.selectionBoxes.has(element)) return
    if (selected) this.selection.add(element)
    else this.selection.delete(element)
    this.selectionBoxes.get(element)!.classList.toggle('markdoc-checked', selected)
    this.onSelectionChange?.(this.getSelectedInOrder())
  }

  isMessageSelected(element: HTMLElement): boolean {
    return this.selection.has(element)
  }

  getSelectedInOrder(): HTMLElement[] {
    // 按 DOM 顺序返回已选元素
    const all = Array.from(this.selectionBoxes.keys())
    return all.filter((el) => this.selection.has(el))
  }

  showSelectionBar(info: { count: number; total: number }, actions: {
    onSelectAll: () => void
    onSelectNone: () => void
    onSelectUsers: () => void
    onSelectAssistants: () => void
    onInvert: () => void
    onExportWord: () => void
    onExportPdf: () => void
    onEditInMarkDoc: () => void
    onExit: () => void
  }): void {
    this.closeSelectionBar()
    const bar = this.el('div', 'markdoc-selection-bar')
    bar.id = 'markdoc-selection-bar'
    const count = this.el('span', 'markdoc-selection-count', bar)
    count.textContent = `已选择 ${info.count} / ${info.total} 条`

    const add = (label: string, onClick: () => void, primary = false) => {
      const b = this.el('button', 'markdoc-btn' + (primary ? ' markdoc-primary' : ''), bar)
      b.textContent = label
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        onClick()
      })
      return b
    }
    add('全选', actions.onSelectAll)
    add('全不选', actions.onSelectNone)
    add('只选用户', actions.onSelectUsers)
    add('只选 AI', actions.onSelectAssistants)
    add('反选', actions.onInvert)
    add('导出 Word', actions.onExportWord, true)
    add('导出 PDF', actions.onExportPdf, true)
    add('在 MarkDoc 中编辑', actions.onEditInMarkDoc)
    add('✕', actions.onExit)
    this.shadow.appendChild(bar)
  }

  updateSelectionCount(count: number, total: number): void {
    const countEl = this.shadow.querySelector('.markdoc-selection-count')
    if (countEl) countEl.textContent = `已选择 ${count} / ${total} 条`
    const exportBtns = this.shadow.querySelectorAll('.markdoc-selection-bar .markdoc-btn.markdoc-primary')
    exportBtns.forEach((b) => ((b as HTMLButtonElement).disabled = count === 0))
  }

  closeSelectionBar(): void {
    this.shadow.querySelector('.markdoc-selection-bar')?.remove()
  }

  // ── 定位 ──────────────────────────────────────────────────────────────────

  private positionFor(float: HTMLElement, target: HTMLElement, side: 'left' | 'right'): void {
    const rect = target.getBoundingClientRect()
    const size = side === 'right' ? 30 : 22
    const x = side === 'right' ? rect.right - size - 6 : rect.left + 6
    float.style.left = `${Math.max(4, x)}px`
    float.style.top = `${Math.max(4, rect.top + 6)}px`
  }

  private scheduleReposition = () => {
    if (this.rafPending) return
    this.rafPending = true
    requestAnimationFrame(() => {
      this.rafPending = false
      for (const [element, btn] of this.messageButtons) this.positionFor(btn, element, 'right')
      for (const [element, box] of this.selectionBoxes) this.positionFor(box, element, 'left')
    })
  }

  refreshPositions(): void {
    this.scheduleReposition()
  }

  /** 元素被页面移除后清理对应悬浮件 */
  pruneRemoved(): void {
    for (const [element, btn] of this.messageButtons) {
      if (!element.isConnected) {
        btn.remove()
        this.messageButtons.delete(element)
      }
    }
    for (const [element, box] of this.selectionBoxes) {
      if (!element.isConnected) {
        box.remove()
        this.selectionBoxes.delete(element)
        this.selection.delete(element)
      }
    }
  }

  // ── 菜单 / 弹窗 / Toast ───────────────────────────────────────────────────

  showMessageMenu(
    anchorElement: HTMLElement,
    title: string,
    items: UIMenuItem[],
  ): void {
    this.closeMenus()
    const menu = this.el('div', 'markdoc-menu')
    const rect = anchorElement.getBoundingClientRect()
    menu.style.left = `${Math.min(window.innerWidth - 200, rect.left - 140)}px`
    menu.style.top = `${rect.bottom + 8}px`
    const t = this.el('div', 'markdoc-menu-title', menu)
    t.textContent = title
    for (const item of items) {
      if (item === 'separator') this.el('div', 'markdoc-menu-sep', menu)
      else menu.appendChild(this.makeMenuItem(item.label, item.icon ?? '', item.onClick, item.danger))
    }
    this.shadow.appendChild(menu)
    setTimeout(() => {
      document.addEventListener('click', this.globalCloseOnce, { capture: true, once: true })
    }, 0)
  }

  private globalCloseOnce = () => {
    this.closeMenus()
  }

  closeMenus(): void {
    this.shadow.querySelectorAll('.markdoc-menu').forEach((m) => m.remove())
  }

  /** 流式生成中的确认框（规范二十九节：提示 + 继续导出/取消，不无限等待） */
  confirmGenerating(): Promise<boolean> {
    return this.showDialog({
      title: '当前回答仍在生成',
      body: 'AI 可能还在输出内容。可以继续导出当前已生成的部分，或稍后再试。',
      buttons: [
        { label: '继续导出', primary: true, value: true },
        { label: '取消', value: false },
      ],
    })
  }

  showError(message: string, diagnostics?: string): Promise<boolean> {
    return this.showDialog({
      title: 'MarkDoc 暂时无法完成此操作',
      body: message,
      buttons: diagnostics
        ? [
            { label: '复制诊断信息', primary: true, value: true, copy: diagnostics },
            { label: '关闭', value: false },
          ]
        : [{ label: '关闭', primary: true, value: false }],
    })
  }

  private showDialog(opts: {
    title: string
    body: string
    buttons: Array<{ label: string; primary?: boolean; value: boolean; copy?: string }>
  }): Promise<boolean> {
    return new Promise((resolve) => {
      const mask = this.el('div', 'markdoc-dialog-mask')
      const dialog = this.el('div', 'markdoc-dialog', mask)
      const h = this.el('h3', '', dialog)
      h.textContent = opts.title
      const p = this.el('p', '', dialog)
      p.textContent = opts.body
      const actions = this.el('div', 'markdoc-dialog-actions', dialog)
      for (const b of opts.buttons) {
        const btn = this.el('button', 'markdoc-btn' + (b.primary ? ' markdoc-primary' : ''), actions)
        btn.textContent = b.label
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (b.copy && navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(b.copy)
            this.toast('📋 诊断信息已复制（不含聊天内容）')
          }
          mask.remove()
          resolve(b.value)
        })
      }
      mask.addEventListener('click', (e) => {
        if (e.target === mask) {
          mask.remove()
          resolve(false)
        }
      })
      this.shadow.appendChild(mask)
    })
  }

  toast(message: string, durationMs = 2600): void {
    this.shadow.querySelector('.markdoc-toast')?.remove()
    if (this.toastTimer) clearTimeout(this.toastTimer)
    const t = this.el('div', 'markdoc-toast')
    t.textContent = message
    this.shadow.appendChild(t)
    this.toastTimer = setTimeout(() => t.remove(), durationMs)
  }
}
