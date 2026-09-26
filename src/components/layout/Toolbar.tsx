import type { TemplateId } from '../../core/templates'
import { DESKTOP_DOWNLOAD_URL } from '../../platform'
import TemplateQuickSwitch from './TemplateQuickSwitch'

interface ToolbarProps {
  busy: boolean
  onExportWord: () => void
  onExportPdf: () => void
  onPreviewPdf: () => void
  onCopyRich: () => void
  onSmartFormat: () => void
  onDeepFix: () => void
  onRepairFormat: () => void
  onOpenSettings: () => void
  onOpenHistory: () => void
  darkMode: boolean
  onToggleDarkMode: () => void
  scrollSyncEnabled: boolean
  onToggleScrollSync: () => void
  /** 快速模式：模板缩略图一键切换（自定义模板走高级设置） */
  templateId: string
  onTemplateChange: (id: TemplateId) => void
  /** 当前是否运行在 Electron 桌面版（是则隐藏「桌面版」入口） */
  desktop: boolean
}

const ghostBtn =
  'px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'

export default function Toolbar({
  busy,
  onExportWord,
  onExportPdf,
  onPreviewPdf,
  onCopyRich,
  onSmartFormat,
  onDeepFix,
  onRepairFormat,
  onOpenSettings,
  onOpenHistory,
  darkMode,
  onToggleDarkMode,
  scrollSyncEnabled,
  onToggleScrollSync,
  templateId,
  onTemplateChange,
  desktop,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm transition-colors flex-wrap">
      {/* Title */}
      <div className="mr-3 whitespace-nowrap">
        <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100 leading-tight">MarkDoc</h1>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight hidden sm:block">
          AI 回答 → 排版好的 Word / PDF
        </p>
      </div>

      {/* 快速模式：模板即点即换 */}
      <TemplateQuickSwitch current={templateId} onChange={onTemplateChange} />

      <span className="w-px h-6 bg-gray-200 dark:bg-gray-600 mx-1 hidden md:block" />

      {/* 文档修复类 */}
      <div className="flex gap-1 flex-wrap items-center">
        <button
          onClick={onRepairFormat}
          className={ghostBtn}
          title="自动补全未闭合的代码块、公式、粗体，修复表格"
        >
          🪄 修复格式
        </button>
        <button
          onClick={onSmartFormat}
          className={ghostBtn}
          title="智能识别并转换普通序号为 Markdown 标题"
        >
          ✨ 智能排版
        </button>
        <button
          onClick={onDeepFix}
          className={ghostBtn}
          title="AI 内容修复：公式乱码（Word 线性公式 / 定界符 / 裸环境）、Mermaid 图表围栏重建、全角与零宽字符清理、编码乱码，修复后可直接导出 Word"
        >
          🧩 AI 修复
        </button>
      </div>

      <span className="w-px h-6 bg-gray-200 dark:bg-gray-600 mx-1 hidden md:block" />

      {/* 高级设置 / 历史 */}
      <div className="flex gap-1 flex-wrap items-center">
        <button onClick={onOpenSettings} className={ghostBtn} title="字体、字号、行距、页边距、页眉页脚、目录、标题编号等全部导出设置">
          ⚙ 高级设置
        </button>
        <button onClick={onOpenHistory} className={ghostBtn} title="浏览器本地保存的历史文档">
          🕘 历史
        </button>
      </div>

      <div className="flex-1" />

      {/* 导出区：Word / PDF 同等主按钮 */}
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={onCopyRich}
          className={ghostBtn}
          title="复制渲染后的内容，直接粘贴进 Word 可保留排版"
        >
          复制
        </button>
        <button
          onClick={onPreviewPdf}
          disabled={busy}
          className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          title="查看最终效果：真实分页、页眉页脚、页码，导出前先看「第 3 页是什么样」"
        >
          最终效果
        </button>
        <button
          onClick={onExportPdf}
          disabled={busy}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-md shadow-sm transition-colors disabled:opacity-60"
        >
          导出 PDF
        </button>
        <button
          onClick={onExportWord}
          disabled={busy}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md shadow-sm transition-colors disabled:opacity-60"
        >
          导出 Word
        </button>

        <span className="w-px h-6 bg-gray-200 dark:bg-gray-600 mx-1" />

        <button
          onClick={onToggleScrollSync}
          className={ghostBtn}
          title={scrollSyncEnabled ? '已开启滚动同步' : '已关闭滚动同步'}
        >
          {scrollSyncEnabled ? '🔗' : '⛓'}
        </button>
        <button
          onClick={onToggleDarkMode}
          className={ghostBtn}
          title={darkMode ? '切换亮色模式' : '切换暗色模式'}
        >
          {darkMode ? '☀' : '🌙'}
        </button>
        {!desktop && (
          <button
            onClick={() => window.open(DESKTOP_DOWNLOAD_URL, '_blank', 'noopener')}
            className={`${ghostBtn} hidden lg:block text-gray-400 dark:text-gray-500`}
            title="需要打开本地 Markdown、自动保存或桌面文件管理？下载 MarkDoc Desktop（可选增强，在线版功能不受影响）"
          >
            🖥 桌面版
          </button>
        )}
      </div>
    </div>
  )
}
