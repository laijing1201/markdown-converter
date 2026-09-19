/**
 * 文档模板与排版设置 —— 单一数据源：
 *
 * 1. 系统模板（通用文档 / 学术论文 / 商务报告）提供排版种子值与论文启发式；
 * 2. DocSettings（schema v3）携带全部可自定义排版项，同时驱动网页预览
 *    （PreviewPanel 的 CSS 变量）与 DOCX 导出（exporter.ts），保证"预览即所得"；
 * 3. 自定义模板 = 用户排版快照，存 localStorage（带 schema version），
 *    支持另存为 / 重命名 / 删除。
 */

export type TemplateId = 'general' | 'academic' | 'report'

export type TableStyle = 'threeline' | 'grid' | 'shaded'

export type PaperSize = 'a4' | 'letter'
export type Orientation = 'portrait' | 'landscape'
export type FirstLineIndentMode = 'none' | '2chars'
export type BodyAlign = 'left' | 'justify'
export type HeadingNumberingMode = 'off' | '1' | '1.1' | '1.1.1'
export type MarginPreset = 'narrow' | 'normal' | 'wide' | 'custom'

export interface TemplateConfig {
  id: TemplateId
  name: string
  description: string
  /** 论文启发式：首 H1 作为居中论文题目、识别 摘要/关键词/参考文献 等 */
  academicHeuristics: boolean
  bodyFontZh: string
  bodyFontEn: string
  headingFont: string
  /** 半磅（half-points），24 = 12pt 小四 */
  bodySize: number
  /** 行距，240 = 单倍，360 = 1.5 倍 */
  lineSpacing: number
  /** 段前/段后距（pt） */
  spaceBeforePt: number
  spaceAfterPt: number
  firstLineIndent: FirstLineIndentMode
  bodyAlign: BodyAlign
  paper: PaperSize
  orientation: Orientation
  margin: MarginPreset
  h1Size: number
  h2Size: number
  h3Size: number
  h4Size: number
  h1Color: string
  h2Color: string
  tableStyle: TableStyle
}

export const TEMPLATE_CONFIGS: Record<TemplateId, TemplateConfig> = {
  general: {
    id: 'general',
    name: '通用文档',
    description: '适合日常笔记、AI 问答整理。宋体正文、左对齐标题、首行缩进。',
    academicHeuristics: false,
    bodyFontZh: 'SimSun',
    bodyFontEn: 'Times New Roman',
    headingFont: 'SimHei',
    bodySize: 24,
    lineSpacing: 360,
    spaceBeforePt: 0,
    spaceAfterPt: 6,
    firstLineIndent: '2chars',
    bodyAlign: 'justify',
    paper: 'a4',
    orientation: 'portrait',
    margin: 'normal',
    h1Size: 32,
    h2Size: 28,
    h3Size: 24,
    h4Size: 24,
    h1Color: '000000',
    h2Color: '000000',
    tableStyle: 'grid',
  },
  academic: {
    id: 'academic',
    name: '学术论文',
    description: '标准论文排版：居中大标题、摘要/关键词/参考文献自动识别、三线表。',
    academicHeuristics: true,
    bodyFontZh: 'SimSun',
    bodyFontEn: 'Times New Roman',
    headingFont: 'SimHei',
    bodySize: 24,
    lineSpacing: 360,
    spaceBeforePt: 0,
    spaceAfterPt: 6,
    firstLineIndent: '2chars',
    bodyAlign: 'justify',
    paper: 'a4',
    orientation: 'portrait',
    margin: 'normal',
    h1Size: 44, // 二号 22pt（作为论文题目）
    h2Size: 32, // 三号 16pt
    h3Size: 28, // 四号 14pt
    h4Size: 24,
    h1Color: '000000',
    h2Color: '000000',
    tableStyle: 'threeline',
  },
  report: {
    id: 'report',
    name: '商务报告',
    description: '微软雅黑、深蓝标题层级、表头着色，适合行业分析、汇报材料。',
    academicHeuristics: false,
    bodyFontZh: 'Microsoft YaHei',
    bodyFontEn: 'Calibri',
    headingFont: 'Microsoft YaHei',
    bodySize: 22, // 11pt
    lineSpacing: 300, // 1.25 倍
    spaceBeforePt: 0,
    spaceAfterPt: 6,
    firstLineIndent: 'none',
    bodyAlign: 'left',
    paper: 'a4',
    orientation: 'portrait',
    margin: 'normal',
    h1Size: 36, // 18pt
    h2Size: 28,
    h3Size: 24,
    h4Size: 22,
    h1Color: '1F4E79',
    h2Color: '2E5E8C',
    tableStyle: 'shaded',
  },
}

export const TEMPLATE_ORDER: TemplateId[] = ['general', 'academic', 'report']

// ─── DocSettings（schema v3）─────────────────────────────────────────────────

export interface MarginMm {
  top: number
  right: number
  bottom: number
  left: number
}

export type PageNumberAlign = 'left' | 'center' | 'right'

export interface DocSettings {
  /** 系统 TemplateId 或自定义模板 id（custom-*） */
  template: string
  includeToc: boolean
  includePageNumbers: boolean
  paper: PaperSize
  orientation: Orientation
  bodyFontZh: string
  bodyFontEn: string
  headingFont: string
  /** 半磅，24 = 12pt */
  bodySize: number
  /** 行距（240 = 单倍） */
  lineSpacing: number
  spaceBeforePt: number
  spaceAfterPt: number
  firstLineIndent: FirstLineIndentMode
  bodyAlign: BodyAlign
  marginPreset: MarginPreset
  /** marginPreset = custom 时生效，单位 mm */
  marginCustom: MarginMm
  headingNumbering: HeadingNumberingMode
  /** 文档标题：优先用作文件名与 PDF 元数据 Title（空 = 用第一标题/日期） */
  documentTitle: string
  /** 页眉文字（空 = 不显示页眉），Word / PDF 共用 */
  headerText: string
  /** 页脚文字（空 = 只显示页码），Word / PDF 共用 */
  footerText: string
  /** 页码水平位置 */
  pageNumberAlign: PageNumberAlign
  /** 首页不显示页眉页脚（封面页常见需求） */
  hideFirstPageNumber: boolean
}

export const SETTINGS_SCHEMA_VERSION = 3
export const SETTINGS_KEY = 'markdoc.settings.v3'

/** 从系统模板种子生成完整设置（保留传入的目录/页码开关） */
export function seedSettingsFromTemplate(
  id: TemplateId,
  current?: Pick<DocSettings, 'includeToc' | 'includePageNumbers'>,
): DocSettings {
  const t = TEMPLATE_CONFIGS[id]
  return {
    template: id,
    includeToc: current?.includeToc ?? false,
    includePageNumbers: current?.includePageNumbers ?? true,
    paper: t.paper,
    orientation: t.orientation,
    bodyFontZh: t.bodyFontZh,
    bodyFontEn: t.bodyFontEn,
    headingFont: t.headingFont,
    bodySize: t.bodySize,
    lineSpacing: t.lineSpacing,
    spaceBeforePt: t.spaceBeforePt,
    spaceAfterPt: t.spaceAfterPt,
    firstLineIndent: t.firstLineIndent,
    bodyAlign: t.bodyAlign,
    marginPreset: t.margin,
    marginCustom: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headingNumbering: 'off',
    documentTitle: '',
    headerText: '',
    footerText: '',
    pageNumberAlign: 'center',
    hideFirstPageNumber: false,
  }
}

export const DEFAULT_SETTINGS: DocSettings = seedSettingsFromTemplate('general')

const asEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

const asNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 容错解析：任何字段非法都回退默认值，不让旧数据把应用打挂 */
export function normalizeDocSettings(raw: unknown): DocSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const base = DEFAULT_SETTINGS
  const marginCustom = (r.marginCustom ?? {}) as Record<string, unknown>
  return {
    template: typeof r.template === 'string' && r.template ? r.template : base.template,
    includeToc: typeof r.includeToc === 'boolean' ? r.includeToc : base.includeToc,
    includePageNumbers: typeof r.includePageNumbers === 'boolean' ? r.includePageNumbers : base.includePageNumbers,
    paper: asEnum(r.paper, ['a4', 'letter'] as const, base.paper),
    orientation: asEnum(r.orientation, ['portrait', 'landscape'] as const, base.orientation),
    bodyFontZh: typeof r.bodyFontZh === 'string' && r.bodyFontZh ? r.bodyFontZh : base.bodyFontZh,
    bodyFontEn: typeof r.bodyFontEn === 'string' && r.bodyFontEn ? r.bodyFontEn : base.bodyFontEn,
    headingFont: typeof r.headingFont === 'string' && r.headingFont ? r.headingFont : base.headingFont,
    bodySize: asNumber(r.bodySize, base.bodySize, 14, 72),
    lineSpacing: asNumber(r.lineSpacing, base.lineSpacing, 120, 960),
    spaceBeforePt: asNumber(r.spaceBeforePt, base.spaceBeforePt, 0, 48),
    spaceAfterPt: asNumber(r.spaceAfterPt, base.spaceAfterPt, 0, 48),
    firstLineIndent: asEnum(r.firstLineIndent, ['none', '2chars'] as const, base.firstLineIndent),
    bodyAlign: asEnum(r.bodyAlign, ['left', 'justify'] as const, base.bodyAlign),
    marginPreset: asEnum(r.marginPreset, ['narrow', 'normal', 'wide', 'custom'] as const, base.marginPreset),
    marginCustom: {
      top: asNumber(marginCustom.top, 25.4, 5, 60),
      right: asNumber(marginCustom.right, 25.4, 5, 60),
      bottom: asNumber(marginCustom.bottom, 25.4, 5, 60),
      left: asNumber(marginCustom.left, 25.4, 5, 60),
    },
    headingNumbering: asEnum(r.headingNumbering, ['off', '1', '1.1', '1.1.1'] as const, base.headingNumbering),
    documentTitle: typeof r.documentTitle === 'string' ? r.documentTitle : base.documentTitle,
    headerText: typeof r.headerText === 'string' ? r.headerText : base.headerText,
    footerText: typeof r.footerText === 'string' ? r.footerText : base.footerText,
    pageNumberAlign: asEnum(r.pageNumberAlign, ['left', 'center', 'right'] as const, base.pageNumberAlign),
    hideFirstPageNumber: typeof r.hideFirstPageNumber === 'boolean' ? r.hideFirstPageNumber : base.hideFirstPageNumber,
  }
}

/** v3 优先；读不到时迁移 v2（template/toc/pagenumbers），其余字段用模板种子 */
export function loadDocSettings(): DocSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return normalizeDocSettings(JSON.parse(raw))
  } catch { /* fallthrough to legacy */ }
  try {
    const legacy = localStorage.getItem('markdoc.settings.v2')
    if (legacy) {
      const v2 = JSON.parse(legacy) as Partial<DocSettings>
      const id: TemplateId =
        typeof v2.template === 'string' && v2.template in TEMPLATE_CONFIGS
          ? (v2.template as TemplateId)
          : 'general'
      return seedSettingsFromTemplate(id, {
        includeToc: !!v2.includeToc,
        includePageNumbers: v2.includePageNumbers !== false,
      })
    }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS
}

export function saveDocSettings(settings: DocSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch { /* 设置保存失败不阻塞主流程 */ }
}

// ─── 自定义模板 ──────────────────────────────────────────────────────────────

export interface CustomTemplate {
  id: string
  name: string
  /** 派生自哪个系统模板（决定论文启发式/表格样式等不可编辑项） */
  baseId: TemplateId
  createdAt: number
  settings: DocSettings
}

const CUSTOM_KEY = 'markdoc.customTemplates.v1'
const CUSTOM_SCHEMA_VERSION = 1
const MAX_CUSTOM_TEMPLATES = 30

interface CustomStore {
  schemaVersion: number
  templates: CustomTemplate[]
}

function loadCustomStore(): CustomStore {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as CustomStore
      if (parsed && parsed.schemaVersion === CUSTOM_SCHEMA_VERSION && Array.isArray(parsed.templates)) {
        return parsed
      }
      // 旧结构：直接是数组（历史上不存在，防御性兼容）
      if (Array.isArray(parsed)) {
        return { schemaVersion: CUSTOM_SCHEMA_VERSION, templates: parsed as CustomTemplate[] }
      }
    }
  } catch { /* ignore */ }
  return { schemaVersion: CUSTOM_SCHEMA_VERSION, templates: [] }
}

function persistCustomStore(store: CustomStore): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(store))
    return { ok: true }
  } catch {
    return { ok: false, error: '浏览器本地存储空间不足，模板保存失败' }
  }
}

export function loadCustomTemplates(): CustomTemplate[] {
  return loadCustomStore().templates
}

export interface CustomTemplateOpResult {
  ok: boolean
  error?: string
  template?: CustomTemplate
}

export function createCustomTemplate(
  name: string,
  baseId: TemplateId,
  settings: DocSettings,
): CustomTemplateOpResult {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: '请输入模板名称' }
  const store = loadCustomStore()
  if (store.templates.length >= MAX_CUSTOM_TEMPLATES) {
    return { ok: false, error: `自定义模板最多 ${MAX_CUSTOM_TEMPLATES} 个，请先删除不需要的` }
  }
  const template: CustomTemplate = {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed.slice(0, 30),
    baseId,
    createdAt: Date.now(),
    settings: { ...settings },
  }
  store.templates.push(template)
  const res = persistCustomStore(store)
  return res.ok ? { ok: true, template } : res
}

export function renameCustomTemplate(id: string, name: string): CustomTemplateOpResult {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: '请输入模板名称' }
  const store = loadCustomStore()
  const tpl = store.templates.find((t) => t.id === id)
  if (!tpl) return { ok: false, error: '模板不存在' }
  tpl.name = trimmed.slice(0, 30)
  const res = persistCustomStore(store)
  return res.ok ? { ok: true, template: tpl } : res
}

export function deleteCustomTemplate(id: string): CustomTemplateOpResult {
  const store = loadCustomStore()
  store.templates = store.templates.filter((t) => t.id !== id)
  const res = persistCustomStore(store)
  return res.ok ? { ok: true } : res
}

/** 系统 id 直接查表；自定义 id 查 store 后取其 baseId 的系统配置 */
export function resolveTemplateBase(templateId: string): TemplateConfig {
  if (templateId in TEMPLATE_CONFIGS) return TEMPLATE_CONFIGS[templateId as TemplateId]
  const custom = loadCustomTemplates().find((t) => t.id === templateId)
  return TEMPLATE_CONFIGS[custom?.baseId ?? 'general']
}

export function getTemplateLabel(templateId: string, customs?: CustomTemplate[]): string {
  if (templateId in TEMPLATE_CONFIGS) return TEMPLATE_CONFIGS[templateId as TemplateId].name
  const list = customs ?? loadCustomTemplates()
  return list.find((t) => t.id === templateId)?.name ?? '自定义模板'
}

// ─── 页面几何（DOCX twips / 预览 px 共用）────────────────────────────────────

export const PAGE_SIZE_TWIPS: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 11906, height: 16838 },
  letter: { width: 12240, height: 15840 },
}

/** 96dpi 下的页面像素（预览用） */
export const PAGE_SIZE_PX: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
}

export const MARGIN_PRESETS_TWIPS: Record<Exclude<MarginPreset, 'custom'>, MarginMm> = {
  narrow: { top: 720, right: 720, bottom: 720, left: 720 },
  normal: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
  wide: { top: 1440, right: 2160, bottom: 1440, left: 2160 },
}

const MM_PER_TWIPS = 1 / 56.6929

export function getMarginsTwips(s: DocSettings): MarginMm {
  if (s.marginPreset === 'custom') {
    const mmToTwips = (mm: number) => Math.round(mm / MM_PER_TWIPS)
    return {
      top: mmToTwips(s.marginCustom.top),
      right: mmToTwips(s.marginCustom.right),
      bottom: mmToTwips(s.marginCustom.bottom),
      left: mmToTwips(s.marginCustom.left),
    }
  }
  return MARGIN_PRESETS_TWIPS[s.marginPreset]
}

// ─── 页面几何（PDF pt / 布局 px 共用）────────────────────────────────────────

/** twips → pt（1pt = 20 twips） */
export function getPageSizePt(s: DocSettings): { width: number; height: number } {
  const size = PAGE_SIZE_TWIPS[s.paper]
  const landscape = s.orientation === 'landscape'
  return {
    width: (landscape ? size.height : size.width) / 20,
    height: (landscape ? size.width : size.height) / 20,
  }
}

export function getMarginsPt(s: DocSettings): MarginMm {
  const m = getMarginsTwips(s)
  const t = (v: number) => v / 20
  return { top: t(m.top), right: t(m.right), bottom: t(m.bottom), left: t(m.left) }
}

/** 1px（CSS 96dpi）= 0.75pt；PDF 布局阶段以 px 测量、渲染时换算 pt */
export const PX_TO_PT = 0.75

export const LINE_SPACING_PRESETS: Array<{ value: number; label: string }> = [
  { value: 240, label: '单倍' },
  { value: 276, label: '1.15 倍' },
  { value: 360, label: '1.5 倍' },
  { value: 480, label: '2 倍' },
]

export const BODY_SIZE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 21, label: '五号（10.5pt）' },
  { value: 24, label: '小四（12pt）' },
  { value: 28, label: '四号（14pt）' },
  { value: 32, label: '三号（16pt）' },
]

export const FONT_OPTIONS_ZH = [
  { value: 'SimSun', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'FangSong', label: '仿宋' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'DengXian', label: '等线' },
]

export const FONT_OPTIONS_EN = [
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Calibri', label: 'Calibri' },
  { value: 'Cambria', label: 'Cambria' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Georgia', label: 'Georgia' },
]

export const FONT_OPTIONS_HEADING = [
  { value: 'SimHei', label: '黑体' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'SimSun', label: '宋体' },
  { value: 'KaiTi', label: '楷体' },
]

// ─── 预览 CSS 变量 ───────────────────────────────────────────────────────────

/** pt/half-points → 96dpi px */
const halfPointsToPx = (hp: number) => (hp / 2) * (4 / 3)

/**
 * 把设置映射为 #preview-container 上的 CSS 自定义属性。
 * 预览的字体/字号/行距/缩进/对齐/页面几何全部由此驱动，
 * 与 exporter.ts 的 Word 输出使用同一份数值。
 */
export function cssVarsFor(s: DocSettings): Record<string, string> {
  const page = PAGE_SIZE_PX[s.paper]
  const landscape = s.orientation === 'landscape'
  const marginsTw = getMarginsTwips(s)
  const padPx = Math.round(marginsTw.top / 15) // 1440 twips = 96px
  return {
    '--pd-body-font': `"${s.bodyFontEn}", "${s.bodyFontZh}", serif`,
    '--pd-heading-font': `"${s.headingFont}", sans-serif`,
    '--pd-body-size': `${halfPointsToPx(s.bodySize).toFixed(2)}px`,
    '--pd-line': String(s.lineSpacing / 240),
    '--pd-indent': s.firstLineIndent === '2chars' ? '2em' : '0em',
    '--pd-align': s.bodyAlign,
    '--pd-space-before': `${s.spaceBeforePt}pt`,
    '--pd-space-after': `${s.spaceAfterPt}pt`,
    '--pd-page-w': `${landscape ? page.height : page.width}px`,
    '--pd-page-h': `${landscape ? page.width : page.height}px`,
    '--pd-page-pad': `${padPx}px`,
  }
}
