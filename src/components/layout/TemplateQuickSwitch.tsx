import { TEMPLATE_ORDER, type TemplateId } from '../../core/templates'
import TemplateThumb, { templateSpecText } from './TemplateThumb'

interface TemplateQuickSwitchProps {
  current: string
  onChange: (id: TemplateId) => void
}

/**
 * 快速模式的模板切换：三张迷你缩略图卡片，
 * 不用打开高级设置就能换模板（自定义模板仍走高级设置）。
 */
export default function TemplateQuickSwitch({ current, onChange }: TemplateQuickSwitchProps) {
  return (
    <div className="flex gap-1 flex-wrap items-center" role="radiogroup" aria-label="文档模板">
      {TEMPLATE_ORDER.map((id) => {
        const active = current === id
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            data-template={id}
            onClick={() => onChange(id)}
            title={templateSpecText(id)}
            className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-md transition-colors ${
              active
                ? 'bg-blue-50 dark:bg-blue-900/40 ring-1 ring-blue-400 dark:ring-blue-500'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <TemplateThumb id={id} size="sm" />
            <span className={`text-xs leading-tight text-left ${
              active ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-gray-600 dark:text-gray-300'
            }`}>
              {id === 'general' ? '通用' : id === 'academic' ? '学术' : '商务'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
