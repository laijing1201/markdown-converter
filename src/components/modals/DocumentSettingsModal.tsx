import { useState } from 'react'
import TemplateThumb, { templateSpecText } from '../layout/TemplateThumb'
import {
  TEMPLATE_CONFIGS,
  TEMPLATE_ORDER,
  FONT_OPTIONS_ZH,
  FONT_OPTIONS_EN,
  FONT_OPTIONS_HEADING,
  BODY_SIZE_OPTIONS,
  LINE_SPACING_PRESETS,
  getTemplateLabel,
  resolveTemplateBase,
  seedSettingsFromTemplate,
  createCustomTemplate,
  renameCustomTemplate,
  deleteCustomTemplate,
  loadCustomTemplates,
  type DocSettings,
  type CustomTemplate,
  type TemplateId,
} from '../../core/templates'
import { buildDiagnostics } from '../../core/diagnostics'
import { VERSION_LABEL } from '../../version'

interface DocumentSettingsModalProps {
  settings: DocSettings
  customs: CustomTemplate[]
  onChange: (settings: DocSettings) => void
  onCustomsChange: (customs: CustomTemplate[]) => void
  onClose: () => void
  /** 诊断所需的导出状态等（由 App 提供） */
  diagnosticsProvider: () => { markdown: string; preflight: import('../../core/preflight').PreflightResult | null; lastExport: 'ok' | 'fail' | null }
  onToast?: (icon: string, message: string) => void
}

const sectionTitle = 'text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2'
const inputCls =
  'px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-gray-700 dark:text-gray-200 shrink-0">
        {label}
        {hint && <span className="block text-xs text-gray-400">{hint}</span>}
      </span>
      <span className="flex items-center gap-1.5 shrink-0">{children}</span>
    </div>
  )
}

export default function DocumentSettingsModal({
  settings,
  customs,
  onChange,
  onCustomsChange,
  onClose,
  diagnosticsProvider,
  onToast,
}: DocumentSettingsModalProps) {
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [saveAsError, setSaveAsError] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const linePresetValue = LINE_SPACING_PRESETS.find((p) => p.value === settings.lineSpacing)?.value ?? 'custom'

  const handleSaveAs = () => {
    const baseId = resolveTemplateBase(settings.template).id
    const res = createCustomTemplate(saveAsName, baseId, settings)
    if (res.ok && res.template) {
      onCustomsChange(loadCustomTemplates())
      onChange({ ...settings, template: res.template.id })
      setSaveAsOpen(false)
      setSaveAsName('')
      setSaveAsError('')
      onToast?.('💾', `已保存为自定义模板「${res.template.name}」`)
    } else {
      setSaveAsError(res.error ?? '保存失败')
    }
  }

  const handleRename = (tpl: CustomTemplate) => {
    const res = renameCustomTemplate(tpl.id, renameValue)
    if (res.ok) {
      onCustomsChange(loadCustomTemplates())
      if (settings.template === tpl.id) onChange({ ...settings })
      setRenamingId(null)
    }
  }

  const handleDelete = (tpl: CustomTemplate) => {
    const res = deleteCustomTemplate(tpl.id)
    if (res.ok) {
      onCustomsChange(loadCustomTemplates())
      if (settings.template === tpl.id) {
        onChange(seedSettingsFromTemplate('general', settings))
      }
      setDeleteConfirmId(null)
    }
  }

  const handleCopyDiagnostics = async () => {
    const info = diagnosticsProvider()
    const text = buildDiagnostics({ templateId: settings.template, ...info })
    try {
      await navigator.clipboard.writeText(text)
      onToast?.('📋', '已复制诊断信息（不含文档内容）')
    } catch {
      onToast?.('⚠️', '复制失败，请手动截图设置面板')
    }
  }

  const selectTemplate = (id: string) => {
    if (id in TEMPLATE_CONFIGS) {
      // 系统模板：以模板种子覆盖排版项，保留目录/页码开关
      onChange(seedSettingsFromTemplate(id as TemplateId, settings))
    } else {
      const tpl = customs.find((c) => c.id === id)
      if (tpl) onChange({ ...tpl.settings, template: tpl.id })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-2xl w-full mx-4 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">⚙ 文档设置</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">
            ✕
          </button>
        </div>

        {/* ── 模板 ── */}
        <p className={sectionTitle}>排版模板</p>
        <div className="space-y-2 mb-3">
          {TEMPLATE_ORDER.map((id) => {
            const tpl = TEMPLATE_CONFIGS[id]
            const active = settings.template === id
            return (
              <button
                key={id}
                onClick={() => selectTemplate(id)}
                title={templateSpecText(id)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <TemplateThumb id={id} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200'}`}>
                        {tpl.name}
                      </span>
                      {active && <span className="text-xs text-blue-600 dark:text-blue-400">✓ 当前</span>}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{tpl.description}</p>
                  </div>
                </div>
              </button>
            )
          })}

          {/* 自定义模板 */}
          {customs.map((tpl) => {
            const active = settings.template === tpl.id
            return (
              <div
                key={tpl.id}
                className={`px-4 py-3 rounded-lg border transition-colors ${
                  active ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-dashed border-gray-300 dark:border-gray-500'
                }`}
              >
                {renamingId === tpl.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(tpl)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      className={`${inputCls} flex-1 min-w-0`}
                      placeholder="模板名称"
                    />
                    <button onClick={() => handleRename(tpl)} className="text-sm text-blue-600 dark:text-blue-400 px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded">
                      保存
                    </button>
                    <button onClick={() => setRenamingId(null)} className="text-sm text-gray-400 px-2 py-1">
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => selectTemplate(tpl.id)} className="flex-1 text-left min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold truncate ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200'}`}>
                          {tpl.name}
                        </span>
                        {active && <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">✓ 当前</span>}
                        <span className="text-[10px] text-gray-400 shrink-0">基于{TEMPLATE_CONFIGS[tpl.baseId].name}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => { setRenamingId(tpl.id); setRenameValue(tpl.name) }}
                      className="shrink-0 text-xs text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                      title="重命名"
                    >
                      重命名
                    </button>
                    {deleteConfirmId === tpl.id ? (
                      <button
                        onClick={() => handleDelete(tpl)}
                        className="shrink-0 text-xs text-red-600 hover:text-red-700 font-medium"
                      >
                        确认删除
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirmId(tpl.id)}
                        className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                        title="删除"
                      >
                        删除
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 另存为我的模板 */}
        {saveAsOpen ? (
          <div className="mb-5 p-3 rounded-lg border border-blue-200 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/20">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={saveAsName}
                onChange={(e) => { setSaveAsName(e.target.value); setSaveAsError('') }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveAs()
                  if (e.key === 'Escape') { setSaveAsOpen(false); setSaveAsError('') }
                }}
                className={`${inputCls} flex-1 min-w-0`}
                placeholder="例如：数学建模论文 / 公司周报"
                maxLength={30}
              />
              <button onClick={handleSaveAs} className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700">
                保存
              </button>
              <button onClick={() => { setSaveAsOpen(false); setSaveAsError('') }} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
                取消
              </button>
            </div>
            {saveAsError && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{saveAsError}</p>}
          </div>
        ) : (
          <div className="mb-5">
            <button
              onClick={() => setSaveAsOpen(true)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              ＋ 把当前排版另存为我的模板
            </button>
            <span className="text-xs text-gray-400 ml-2">改动字体、行距、页边距等后，保存下来下次直接用</span>
          </div>
        )}

        {/* ── 纸张与页边距 ── */}
        <p className={sectionTitle}>纸张与页边距</p>
        <div className="mb-4 rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-1">
          <Row label="纸张">
            <select
              value={settings.paper}
              onChange={(e) => onChange({ ...settings, paper: e.target.value as DocSettings['paper'] })}
              className={inputCls}
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
            </select>
          </Row>
          <Row label="方向">
            <select
              value={settings.orientation}
              onChange={(e) => onChange({ ...settings, orientation: e.target.value as DocSettings['orientation'] })}
              className={inputCls}
            >
              <option value="portrait">纵向</option>
              <option value="landscape">横向</option>
            </select>
          </Row>
          <Row label="页边距">
            <select
              value={settings.marginPreset}
              onChange={(e) => onChange({ ...settings, marginPreset: e.target.value as DocSettings['marginPreset'] })}
              className={inputCls}
            >
              <option value="narrow">窄（1.27cm）</option>
              <option value="normal">普通（2.54cm）</option>
              <option value="wide">宽（左右 3.81cm）</option>
              <option value="custom">自定义</option>
            </select>
          </Row>
          {settings.marginPreset === 'custom' && (
            <Row label="自定义边距" hint="单位 mm">
              {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                <label key={side} className="flex items-center gap-1 text-xs text-gray-500">
                  {{ top: '上', bottom: '下', left: '左', right: '右' }[side]}
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={0.5}
                    value={settings.marginCustom[side]}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        marginCustom: { ...settings.marginCustom, [side]: Number(e.target.value) || 0 },
                      })
                    }
                    className={`${inputCls} w-16`}
                  />
                </label>
              ))}
            </Row>
          )}
        </div>

        {/* ── 字体与字号 ── */}
        <p className={sectionTitle}>字体与字号</p>
        <div className="mb-4 rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-1">
          <Row label="中文字体" hint="正文中的中文">
            <select
              value={settings.bodyFontZh}
              onChange={(e) => onChange({ ...settings, bodyFontZh: e.target.value })}
              className={inputCls}
            >
              {FONT_OPTIONS_ZH.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Row>
          <Row label="西文字体" hint="正文中的英文与数字">
            <select
              value={settings.bodyFontEn}
              onChange={(e) => onChange({ ...settings, bodyFontEn: e.target.value })}
              className={inputCls}
            >
              {FONT_OPTIONS_EN.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Row>
          <Row label="标题字体">
            <select
              value={settings.headingFont}
              onChange={(e) => onChange({ ...settings, headingFont: e.target.value })}
              className={inputCls}
            >
              {FONT_OPTIONS_HEADING.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Row>
          <Row label="正文字号">
            <select
              value={settings.bodySize}
              onChange={(e) => onChange({ ...settings, bodySize: Number(e.target.value) })}
              className={inputCls}
            >
              {BODY_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Row>
        </div>

        {/* ── 段落 ── */}
        <p className={sectionTitle}>段落</p>
        <div className="mb-4 rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-1">
          <Row label="行距">
            <span className="flex items-center gap-1 flex-wrap">
              {LINE_SPACING_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => onChange({ ...settings, lineSpacing: p.value })}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    linePresetValue === p.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => onChange({ ...settings, lineSpacing: 300 })}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  linePresetValue === 'custom'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
                }`}
              >
                自定义
              </button>
              {linePresetValue === 'custom' && (
                <input
                  type="number"
                  min={1}
                  max={4}
                  step={0.05}
                  value={(settings.lineSpacing / 240).toFixed(2)}
                  onChange={(e) =>
                    onChange({ ...settings, lineSpacing: Math.round((Number(e.target.value) || 1) * 240) })
                  }
                  className={`${inputCls} w-20`}
                  title="行距倍数"
                />
              )}
            </span>
          </Row>
          <Row label="段前距 / 段后距" hint="单位 pt">
            <input
              type="number"
              min={0}
              max={48}
              step={0.5}
              value={settings.spaceBeforePt}
              onChange={(e) => onChange({ ...settings, spaceBeforePt: Number(e.target.value) || 0 })}
              className={`${inputCls} w-16`}
            />
            <span className="text-gray-400">/</span>
            <input
              type="number"
              min={0}
              max={48}
              step={0.5}
              value={settings.spaceAfterPt}
              onChange={(e) => onChange({ ...settings, spaceAfterPt: Number(e.target.value) || 0 })}
              className={`${inputCls} w-16`}
            />
          </Row>
          <Row label="首行缩进">
            <select
              value={settings.firstLineIndent}
              onChange={(e) => onChange({ ...settings, firstLineIndent: e.target.value as DocSettings['firstLineIndent'] })}
              className={inputCls}
            >
              <option value="none">无</option>
              <option value="2chars">2 字符</option>
            </select>
          </Row>
          <Row label="正文对齐">
            <select
              value={settings.bodyAlign}
              onChange={(e) => onChange({ ...settings, bodyAlign: e.target.value as DocSettings['bodyAlign'] })}
              className={inputCls}
            >
              <option value="left">左对齐</option>
              <option value="justify">两端对齐</option>
            </select>
          </Row>
        </div>

        {/* ── 标题与页面元素 ── */}
        <p className={sectionTitle}>标题与页面元素</p>
        <div className="mb-4 rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-1">
          <Row label="标题自动编号" hint="如 1 绪论 / 1.1 研究背景">
            <select
              value={settings.headingNumbering}
              onChange={(e) => onChange({ ...settings, headingNumbering: e.target.value as DocSettings['headingNumbering'] })}
              className={inputCls}
            >
              <option value="off">关闭</option>
              <option value="1">1</option>
              <option value="1.1">1.1</option>
              <option value="1.1.1">1.1.1</option>
            </select>
          </Row>
          <Row label="自动目录" hint="Word 打开时提示「更新域」；PDF 为内置静态目录，条目可点击跳转">
            <input
              type="checkbox"
              checked={settings.includeToc}
              onChange={(e) => onChange({ ...settings, includeToc: e.target.checked })}
              className="w-4 h-4 accent-blue-600"
            />
          </Row>
          <Row label="页脚页码">
            <input
              type="checkbox"
              checked={settings.includePageNumbers}
              onChange={(e) => onChange({ ...settings, includePageNumbers: e.target.checked })}
              className="w-4 h-4 accent-blue-600"
            />
          </Row>
          <Row label="页码位置" hint="Word 与 PDF 共用">
            <select
              value={settings.pageNumberAlign}
              onChange={(e) => onChange({ ...settings, pageNumberAlign: e.target.value as DocSettings['pageNumberAlign'] })}
              className={inputCls}
            >
              <option value="center">居中</option>
              <option value="left">靠左</option>
              <option value="right">靠右</option>
            </select>
          </Row>
          <Row label="首页不显示页眉页脚" hint="封面页常见排版">
            <input
              type="checkbox"
              checked={settings.hideFirstPageNumber}
              onChange={(e) => onChange({ ...settings, hideFirstPageNumber: e.target.checked })}
              className="w-4 h-4 accent-blue-600"
            />
          </Row>
          <Row label="页眉文字" hint="留空则不显示页眉">
            <input
              type="text"
              value={settings.headerText}
              placeholder="如：XX 大学课程实验报告"
              onChange={(e) => onChange({ ...settings, headerText: e.target.value })}
              className={`${inputCls} w-52`}
            />
          </Row>
          <Row label="页脚文字" hint="与页码同排显示，留空则只显示页码">
            <input
              type="text"
              value={settings.footerText}
              placeholder="如：第 X 页 / 机密"
              onChange={(e) => onChange({ ...settings, footerText: e.target.value })}
              className={`${inputCls} w-52`}
            />
          </Row>
          <Row label="文档标题" hint="优先用作文件名与 PDF 元数据标题">
            <input
              type="text"
              value={settings.documentTitle}
              placeholder="留空则用第一行标题"
              onChange={(e) => onChange({ ...settings, documentTitle: e.target.value })}
              className={`${inputCls} w-52`}
            />
          </Row>
        </div>

        <div className="text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-3 flex items-center justify-between gap-2 flex-wrap">
          <span>🔒 所有内容仅在浏览器本地处理，不上传服务器</span>
          <span className="flex items-center gap-3">
            <button onClick={() => void handleCopyDiagnostics()} className="hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-2" title="复制版本/环境/统计信息用于反馈问题（不含文档内容）">
              复制诊断信息
            </button>
            <span className="text-gray-300 dark:text-gray-600" title={VERSION_LABEL}>{VERSION_LABEL}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
