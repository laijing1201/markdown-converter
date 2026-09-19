import type { TemplateId } from '../../core/templates'
import { TEMPLATE_CONFIGS } from '../../core/templates'

/**
 * 模板迷你缩略图：一张小 "A4 页" 抽象出标题/正文/表格的排版差异。
 * 纯 CSS 绘制，无图片资源；工具栏快速切换与高级设置共用。
 */
export default function TemplateThumb({ id, size = 'md' }: { id: TemplateId; size?: 'sm' | 'md' }) {
  const cfg = TEMPLATE_CONFIGS[id]
  const dim = size === 'sm'
    ? { w: 'w-6', h: 'h-8', pad: 'p-[3px]', gap: 'space-y-[2px]', line: 'h-px' }
    : { w: 'w-8', h: 'h-11', pad: 'p-1', gap: 'space-y-[3px]', line: 'h-[2px]' }
  const accent = id === 'report' ? '#1F4E79' : '#1F2937'

  return (
    <div
      className={`${dim.w} ${dim.h} ${dim.pad} shrink-0 rounded-[3px] border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-100 overflow-hidden`}
      aria-hidden
    >
      <div className={dim.gap}>
        {/* 标题 */}
        {id === 'academic' ? (
          <div className="flex justify-center">
            <div className={`${dim.line} w-2/3`} style={{ background: accent, height: size === 'sm' ? 2 : 3 }} />
          </div>
        ) : (
          <div className={dim.line} style={{ background: accent, width: '55%', height: size === 'sm' ? 2 : 3 }} />
        )}
        {/* 正文行 */}
        {[1, 0.9, 0.95].map((w, i) => (
          <div
            key={i}
            className={`${dim.line} bg-gray-300 dark:bg-gray-400`}
            style={{ width: `${w * 88}%`, marginLeft: id === 'general' && i > 0 ? '12%' : 0 }}
          />
        ))}
        {/* 表格暗示 */}
        {cfg.tableStyle === 'threeline' ? (
          <div className="border-t-2 border-b-2 border-gray-700 py-[2px]">
            <div className={`${dim.line} w-3/4 bg-gray-400`} />
          </div>
        ) : cfg.tableStyle === 'shaded' ? (
          <div className="py-[1px]">
            <div className="bg-[#EEF2F8] border border-gray-300 rounded-[1px] h-[7px] w-full" />
          </div>
        ) : (
          <div className="border border-gray-400 rounded-[1px] h-[9px] w-full grid grid-cols-3 gap-px p-px">
            <i className="bg-gray-200" /><i className="bg-gray-200" /><i className="bg-gray-200" />
          </div>
        )}
        {/* 更多正文 */}
        <div className={`${dim.line} w-4/5 bg-gray-300 dark:bg-gray-400`} />
        <div className={`${dim.line} w-2/3 bg-gray-300 dark:bg-gray-400`} />
      </div>
    </div>
  )
}

/** hover / 卡片详情用的一句话规格说明 */
export function templateSpecText(id: TemplateId): string {
  const t = TEMPLATE_CONFIGS[id]
  const line = (t.lineSpacing / 240).toFixed(t.lineSpacing % 240 === 0 ? 0 : 2)
  const margin = t.margin === 'normal' ? '适中' : t.margin === 'narrow' ? '窄' : '宽'
  return `${t.description}（字体 ${t.bodyFontZh} / ${t.bodyFontEn} · ${line} 倍行距 · 页边距${margin}）`
}
