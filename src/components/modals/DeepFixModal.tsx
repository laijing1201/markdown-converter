import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { deepAnalyzeEncoding, type FixCandidate } from '../../core/markdown'
import {
  analyzeAiWordProblems,
  fixAiWordContent,
  DEFAULT_AI_WORD_FIX_OPTIONS,
  type AiWordFix,
  type AiWordFixOptions,
  type AiWordFixCategory,
} from '../../core/aiWordFix'

interface DeepFixModalProps {
  content: string
  onApply: (result: { fixed: string; summary: string[] }) => void
  /** 应用修复后直接导出 Word（用户点了「修复并导出」） */
  onApplyAndExport?: (result: { fixed: string; summary: string[] }) => void
  onClose: () => void
}

type Phase = 'scanning' | 'complete'

interface CategoryMeta {
  key: AiWordFixCategory
  icon: string
  name: string
  desc: string
}

const CATEGORY_META: CategoryMeta[] = [
  { key: 'math', icon: '🧮', name: '公式断层', desc: '定界符转换 · Word 线性公式 → LaTeX · 裸公式环境包裹' },
  { key: 'chart', icon: '📊', name: '图表错位', desc: '重建被对话界面剥离的 Mermaid 围栏' },
  { key: 'structure', icon: '🧹', name: '结构污染', desc: '全角字母数字 · 零宽字符 · NBSP 清理' },
]

const SCAN_STEPS = ['公式断层检查', '图表错位检查', '结构污染检查', '编码乱码检查']

export default function DeepFixModal({ content, onApply, onApplyAndExport, onClose }: DeepFixModalProps) {
  const [phase, setPhase] = useState<Phase>('scanning')
  const [progress, setProgress] = useState(0)
  const [stepIdx, setStepIdx] = useState(-1)
  const [problems, setProblems] = useState<AiWordFix[]>([])
  const [encodingCandidates, setEncodingCandidates] = useState<FixCandidate[]>([])
  const [encodingIdx, setEncodingIdx] = useState(-1)
  const [enabled, setEnabled] = useState<Record<AiWordFixCategory, boolean>>({
    math: true,
    chart: true,
    structure: true,
  })
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    // 分析本身是同步轻量的；分步动画只做进度反馈
    const found = analyzeAiWordProblems(content)
    const encoding = deepAnalyzeEncoding(content)
    const recommended = encoding.findIndex((c) => c.isDifferent && c.isRecommended)
    setProblems(found)
    setEncodingCandidates(encoding)
    setEncodingIdx(recommended)

    const t: ReturnType<typeof setTimeout>[] = []
    SCAN_STEPS.forEach((_, i) => {
      t.push(setTimeout(() => {
        setStepIdx(i)
        setProgress(Math.round(((i + 1) / SCAN_STEPS.length) * 88))
      }, 350 + i * 320))
    })
    t.push(setTimeout(() => {
      setPhase('complete')
      setProgress(100)
    }, 350 + SCAN_STEPS.length * 320 + 250))
    timers.current = t
  }, [content])

  const problemsFor = useCallback((key: AiWordFixCategory) => problems.filter((p) => p.category === key), [problems])
  const categoryCount = useCallback(
    (key: AiWordFixCategory) => problemsFor(key).reduce((sum, p) => sum + p.count, 0),
    [problemsFor],
  )
  const categoryExamples = useCallback(
    (key: AiWordFixCategory) => problemsFor(key).flatMap((p) => p.exampleLines).slice(0, 3),
    [problemsFor],
  )

  const encodingCandidate = encodingIdx >= 0 ? encodingCandidates[encodingIdx] : null
  const totalFixCount = useMemo(
    () => (CATEGORY_META as CategoryMeta[]).reduce((sum, m) => sum + (enabled[m.key] ? categoryCount(m.key) : 0), 0) +
      (encodingCandidate ? 1 : 0),
    [enabled, categoryCount, encodingCandidate],
  )

  const buildResult = useCallback(() => {
    const opts: AiWordFixOptions = {
      math: enabled.math,
      chart: enabled.chart,
      structure: enabled.structure,
    }
    // 编码修复优先（字节层），再跑格式断层修复（语法层）
    const encodingFixed = encodingCandidate && encodingIdx >= 0 ? encodingCandidates[encodingIdx].text : content
    const { fixed, fixes } = fixAiWordContent(encodingFixed, { ...DEFAULT_AI_WORD_FIX_OPTIONS, ...opts })

    const summary: string[] = []
    for (const f of fixes) summary.push(`${f.label} ×${f.count}`)
    if (encodingCandidate) summary.push(`编码解码：${encodingCandidate.displayName}`)
    if (summary.length === 0) summary.push('未发现需要修复的问题')

    return { fixed, summary }
  }, [content, enabled, encodingCandidate, encodingIdx, encodingCandidates])

  const handleApply = useCallback((exportAfter: boolean) => {
    const result = buildResult()
    if (exportAfter) {
      onApplyAndExport?.({ fixed: result.fixed, summary: result.summary })
    } else {
      onApply({ fixed: result.fixed, summary: result.summary })
    }
    onClose()
  }, [buildResult, onApply, onApplyAndExport, onClose])

  const hasAnyProblem = problems.length > 0 || encodingIdx >= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4 transition-colors">
        {/* Header */}
        <div className="shrink-0 flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">🧩 AI 内容修复</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              修复 AI 对话复制到 Word 的格式断层：公式乱码 · 图表错位 · 结构污染 · 编码乱码
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Progress */}
          {phase === 'scanning' && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                <span>{stepIdx >= 0 ? SCAN_STEPS[stepIdx] : '正在扫描内容特征...'}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 修复报告（complete 后展示） */}
          {phase === 'complete' && (
            <>
              {!hasAnyProblem && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p className="text-lg mb-1">✅ 内容很干净</p>
                  <p className="text-sm">未检测到公式、图表、结构或编码层面的断层</p>
                </div>
              )}

              {hasAnyProblem && (
                <>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    共发现 {totalFixCount} 处可修复问题，勾选需要应用的类别：
                  </p>

                  {/* 格式断层类别 */}
                  {CATEGORY_META.map((meta) => {
                    const count = categoryCount(meta.key)
                    const exampleLines = categoryExamples(meta.key)
                    const on = enabled[meta.key] && count > 0
                    return (
                      <label
                        key={meta.key}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                          count > 0
                            ? on
                              ? 'border-blue-400 bg-blue-50/60 dark:bg-blue-900/20 dark:border-blue-500 cursor-pointer'
                              : 'border-gray-200 dark:border-gray-600 cursor-pointer'
                            : 'border-gray-100 dark:border-gray-700 opacity-50 cursor-default'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={count === 0}
                          onChange={(e) => setEnabled((prev) => ({ ...prev, [meta.key]: e.target.checked }))}
                          className="mt-1 accent-blue-600"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                              {meta.icon} {meta.name}
                            </span>
                            {count > 0 ? (
                              <span className="text-xs font-semibold text-blue-600 dark:text-blue-300">{count} 处</span>
                            ) : (
                              <span className="text-xs text-gray-400">未发现</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{meta.desc}</p>
                          {exampleLines.length > 0 && (
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                              示例：第 {exampleLines.join('、')} 行
                              {categoryCount(meta.key) > exampleLines.length ? ' 等' : ''}
                            </p>
                          )}
                        </div>
                      </label>
                    )
                  })}

                  {/* 编码乱码（保留原深度解码能力） */}
                  <div
                    className={`p-3 rounded-lg border transition-colors ${
                      encodingCandidate
                        ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-900/20 dark:border-amber-600'
                        : 'border-gray-100 dark:border-gray-700 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">🔤 编码乱码</span>
                      {encodingCandidate ? (
                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-300">发现可修复</span>
                      ) : (
                        <span className="text-xs text-gray-400">未发现</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      UTF-8 / GBK / Big5 深度解码（处理整段不可读的乱码文本）
                    </p>
                    {encodingCandidate && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 font-mono bg-white dark:bg-gray-900 rounded p-2 border border-gray-100 dark:border-gray-700 line-clamp-2">
                        {encodingCandidate.text.slice(0, 120)}
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            取消
          </button>
          {hasAnyProblem && (
            <button
              onClick={() => handleApply(true)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            >
              修复并导出 Word
            </button>
          )}
          <button
            onClick={() => (hasAnyProblem ? handleApply(false) : onClose())}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
          >
            {phase === 'complete' ? (hasAnyProblem ? `应用修复（${totalFixCount} 处）` : '关闭') : '分析中...'}
          </button>
        </div>
      </div>
    </div>
  )
}
