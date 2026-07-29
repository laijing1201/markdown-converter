import { useState, useEffect, useCallback, useRef } from 'react'
import { deepAnalyzeEncoding, type FixCandidate } from '../../core/markdown'

interface DeepFixModalProps {
  content: string
  onApply: (fixed: string) => void
  onClose: () => void
}

type Phase = 'scanning' | 'analyzing' | 'revealing' | 'complete'

interface StrategyStep {
  label: string
  displayName: string
  progressTarget: number
}

const STRATEGY_STEPS: StrategyStep[] = [
  { label: 'utf8',        displayName: 'UTF-8 重解码',    progressTarget: 35 },
  { label: 'latin1-utf8', displayName: 'Latin-1 → UTF-8', progressTarget: 55 },
  { label: 'gbk',         displayName: 'GBK 解码',        progressTarget: 75 },
  { label: 'big5',        displayName: 'Big5 解码',       progressTarget: 90 },
]

export default function DeepFixModal({ content, onApply, onClose }: DeepFixModalProps) {
  const [phase, setPhase] = useState<Phase>('scanning')
  const [progress, setProgress] = useState(0)
  const [currentStepIdx, setCurrentStepIdx] = useState(-1)
  const [candidates, setCandidates] = useState<FixCandidate[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [revealIdx, setRevealIdx] = useState(-1)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Clear all timers on unmount
  useEffect(() => {
    return () => timers.current.forEach(clearTimeout)
  }, [])

  // Start the analysis flow
  useEffect(() => {
    // 1. Run analysis immediately
    const allCandidates = deepAnalyzeEncoding(content)
    setCandidates(allCandidates)

    const t: ReturnType<typeof setTimeout>[] = []

    // 2. Scanning phase: 0 → 15%
    t.push(setTimeout(() => {
      setPhase('analyzing')
      setProgress(15)
      setCurrentStepIdx(0)
    }, 600))

    // 3. Animate through each strategy
    STRATEGY_STEPS.forEach((step, i) => {
      const delay = 600 + (i + 1) * 900
      t.push(setTimeout(() => {
        setProgress(step.progressTarget)
        setCurrentStepIdx(i)
      }, delay))
    })

    // 4. Revealing phase: show each candidate briefly
    t.push(setTimeout(() => {
      setPhase('revealing')
      setProgress(93)
      setCurrentStepIdx(STRATEGY_STEPS.length)
      // Walk through candidates
      const different = allCandidates.filter((c) => c.isDifferent)
      different.forEach((_, i) => {
        t.push(setTimeout(() => {
          setRevealIdx(i)
        }, 600 + i * 700))
      })
    }, 600 + STRATEGY_STEPS.length * 900 + 400))

    // 5. Complete
    t.push(setTimeout(() => {
      setPhase('complete')
      setProgress(100)
    }, 600 + STRATEGY_STEPS.length * 900 + 400 + (differentCount(allCandidates) * 700 + 500)))

    timers.current = t
  }, [content]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = useCallback(() => {
    const candidate = candidates[selectedIdx]
    if (candidate) {
      onApply(candidate.text)
    }
    onClose()
  }, [candidates, selectedIdx, onApply, onClose])

  const different = candidates.filter((c) => c.isDifferent)
  const showCandidates = phase === 'revealing' || phase === 'complete'
  const canSelect = phase === 'complete'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4 transition-colors">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            🛠 深度编码修复
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              <span>{statusMessage(phase, currentStepIdx, STRATEGY_STEPS)}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Strategy steps checklist */}
          <div className="space-y-1.5">
            {STRATEGY_STEPS.map((step, i) => {
              const done = currentStepIdx > i || (phase === 'complete')
              const active = currentStepIdx === i && phase === 'analyzing'
              const candidate = candidates.find((c) => c.label === step.label)
              const hasDiff = candidate && candidate.isDifferent
              return (
                <div
                  key={step.label}
                  className={`flex items-center gap-2.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                    active ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' :
                    done ? 'text-gray-600 dark:text-gray-400' :
                    'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  <span className="shrink-0 w-5 text-center">
                    {done ? '✅' : active ? '⏳' : '⏳'}
                  </span>
                  <span className="flex-1">{step.displayName}</span>
                  {done && hasDiff && candidate.isRecommended && (
                    <span className="text-xs text-green-600 dark:text-green-400">发现可修复</span>
                  )}
                  {done && hasDiff && !candidate.isRecommended && (
                    <span className="text-xs text-red-500 dark:text-red-400">负优化</span>
                  )}
                  {done && !hasDiff && (
                    <span className="text-xs text-gray-400">无变化</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Revealing / Candidate comparison */}
          {showCandidates && different.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                请选择修复方案：
              </h3>
              <div className="space-y-2.5">
                {different.map((c, i) => (
                  <button
                    key={c.label}
                    onClick={() => canSelect && setSelectedIdx(candidates.indexOf(c))}
                    disabled={!canSelect}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                      candidates.indexOf(c) === selectedIdx
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    } ${!canSelect ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm text-gray-800 dark:text-gray-200">
                        {c.displayName}
                      </span>
                      <span className={`text-xs ${c.isRecommended ? 'text-green-500' : 'text-red-500'}`}>
                        {c.isRecommended ? '可修复' : `产生乱码: ${c.replacementCount} 个`}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 leading-relaxed font-mono bg-white dark:bg-gray-900 rounded p-2 border border-gray-100 dark:border-gray-700">
                      {previewText(c.text, 300)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* No fix needed */}
          {phase === 'complete' && different.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              <p className="text-lg mb-1">✅ 未检测到编码问题</p>
              <p className="text-sm">文本已经是正确的编码，无需修复</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            {phase === 'complete' ? '取消' : '跳过'}
          </button>
          <button
            onClick={handleApply}
            disabled={phase !== 'complete' || candidates.length === 0}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              phase === 'complete'
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
            }`}
          >
            {phase === 'complete'
              ? `应用${candidates[selectedIdx]?.isDifferent ? `「${candidates[selectedIdx].displayName}」` : ''}`
              : '分析中...'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusMessage(phase: Phase, stepIdx: number, steps: StrategyStep[]): string {
  if (phase === 'scanning') return '正在扫描编码特征...'
  if (phase === 'analyzing' && stepIdx >= 0 && stepIdx < steps.length) {
    return steps[stepIdx].displayName
  }
  if (phase === 'revealing') return '正在展示修复结果...'
  return '分析完成，请选择方案'
}

function differentCount(candidates: FixCandidate[]): number {
  return candidates.filter((c) => c.isDifferent).length
}

function previewText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen) + '...'
}
