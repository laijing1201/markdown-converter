interface DocStats {
  chars: number
  math: number
  tables: number
  images: number
}

interface StatusBarProps {
  stats: DocStats
  /** 预览 A4 页面高度估算的页数；无法估算时为 null（不显示该项） */
  estPages: number | null
  /** 实时校验告警数（语法 / 乱码） */
  issueCount: number
  onOpenPreflight: () => void
}

const fmt = (n: number) => n.toLocaleString('zh-CN')

/**
 * 编辑区底部低干扰状态条：
 *   1,826 字 · 5 个公式 · 2 个表格 · 3 张图片 · 预计 4 页 | ✓ 文档状态正常 / ⚠ N 个问题
 * 点击右侧状态打开导出前 Preflight 报告。
 */
export default function StatusBar({ stats, estPages, issueCount, onOpenPreflight }: StatusBarProps) {
  const ok = issueCount === 0
  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-1 bg-gray-50 dark:bg-gray-800/60 border-t border-gray-200 dark:border-gray-700 text-[11px] text-gray-500 dark:text-gray-400 select-none">
      <div className="flex items-center gap-2 truncate" data-testid="doc-stats">
        <span>{fmt(stats.chars)} 字</span>
        {stats.math > 0 && <span>· {stats.math} 个公式</span>}
        {stats.tables > 0 && <span>· {stats.tables} 个表格</span>}
        {stats.images > 0 && <span>· {stats.images} 张图片</span>}
        {estPages !== null && <span>· 预计 {estPages} 页</span>}
      </div>
      <button
        onClick={onOpenPreflight}
        data-testid="doc-status"
        className={`shrink-0 px-1.5 py-0.5 rounded transition-colors ${
          ok
            ? 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30'
            : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 font-medium'
        }`}
        title={ok ? '文档状态正常，点击查看导出前检查' : '点击查看问题明细（导出前检查）'}
      >
        {ok ? '✓ 文档状态正常' : `⚠ 发现 ${issueCount} 个问题`}
      </button>
    </div>
  )
}

// ─── 轻量统计（不渲染 KaTeX / DOM，随输入实时可用）────────────────────────────

/** 计数 Markdown 源中的表格分隔行（每张表恰有一行） */
export function countTables(md: string): number {
  return md.split('\n').filter((line) => {
    const t = line.trim()
    return t.includes('|') && t.includes('-') && /^[\s|:+-]+$/.test(t)
  }).length
}

/** 行内 + 块级公式计数（$$ 块整体算 1） */
export function countMath(md: string): number {
  let count = 0
  let rest = md.replace(/\$\$[\s\S]+?\$\$/g, () => {
    count++
    return ''
  })
  rest = rest.replace(/(^|[^\\$])\$(?!\$)[^$\n]+?\$/g, () => {
    count++
    return ''
  })
  return count
}

export function countImages(md: string): number {
  return (md.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length
}
