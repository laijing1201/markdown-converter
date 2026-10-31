import { useEffect, useRef } from 'react'

/**
 * 弹窗 Escape 关闭 —— 键盘行为与背景点击 / ✕ 按钮（onClose）对齐。
 *
 * - 只响应未被阻止的 keydown：输入框自己的 Escape 处理（如取消重命名）
 *   可以先 preventDefault 拦截
 * - 嵌套弹窗只关最上层：以挂载顺序为栈，最后挂载（栈顶）的弹窗才响应，
 *   避免上层弹窗（如登录框）与底层弹窗被一次 Escape 同时关闭
 * - onClose 经 ref 透传，监听器不随渲染重建
 *
 * 不接入本 hook 的弹窗（保持既有语义）：
 *   - ExportProgressModal：导出进行中不允许关闭
 *   - AccountModal：背景点击本就不关闭，只有「关闭」按钮
 *   - DocumentSettingsModal：内部有细粒度的 Escape 处理（取消重命名/另存子框）
 */
const stack: symbol[] = []

export function useEscapeClose(onClose: () => void, enabled = true): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!enabled) return
    const id = Symbol('modal')
    stack.push(id)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (stack[stack.length - 1] !== id) return
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled])
}
