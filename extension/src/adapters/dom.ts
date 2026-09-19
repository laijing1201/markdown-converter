/**
 * Adapter 共用 DOM 工具：选择器求值（带 fallback 链）、命中统计、防重复注入。
 *
 * 规范第六节：平台选择器必须集中管理、优先 data-testid / role / aria-label /
 * data-* / 语义结构，禁止裸 CSS class（哈希类只能作为最后 fallback）。
 */

export interface SelectorHit {
  selector: string
  count: number
}

/** 依序尝试一组选择器，返回第一个命中的元素（记录命中情况） */
export function queryFirst(host: ParentNode, selectors: string[], hits?: Map<string, number>): Element | null {
  for (const selector of selectors) {
    try {
      const el = host.querySelector(selector)
      if (hits) hits.set(selector, (hits.get(selector) ?? 0) + (el ? 1 : 0))
      if (el) return el
    } catch {
      // 非法选择器：跳过
    }
  }
  return null
}

/** 依序尝试一组选择器，返回第一个有命中的列表 */
export function queryAll(host: ParentNode, selectors: string[], hits?: Map<string, number>): Element[] {
  for (const selector of selectors) {
    try {
      const els = Array.from(host.querySelectorAll(selector))
      if (hits) hits.set(selector, (hits.get(selector) ?? 0) + els.length)
      if (els.length > 0) return els
    } catch {
      // 非法选择器：跳过
    }
  }
  return []
}

/** 生成稳定消息 id（同一元素跨调用稳定） */
export function elementId(el: Element, prefix: string): string {
  const existing = el.getAttribute('data-markdoc-id')
  if (existing) return existing
  const id = `${prefix}-${Math.random().toString(36).slice(2, 10)}`
  el.setAttribute('data-markdoc-id', id)
  return id
}

/** 是否可见（偏移为零的隐藏节点不注入按钮） */
export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

/** 读取文本（保留换行） */
export function textOf(el: Element | null): string {
  return (el?.textContent || '').trim()
}
