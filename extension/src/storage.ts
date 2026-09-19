/**
 * 扩展存储层 —— chrome.storage.local 封装：
 *
 * 1. 快速设置（popup/options 里的格式/模板/开关）——带 schemaVersion migration；
 * 2. 导出任务暂存（content script → exporter 引擎页，一次性读取 + TTL）；
 * 3. 「在 MarkDoc 中编辑」临时导入区（30 分钟过期，一次性消费）；
 * 4. Adapter 健康快照（按 hostname，DOM 改版检测基线）；
 * 5. 最近导出结果（诊断信息用，不含内容）；
 * 6. TemplateStorage 统一接口。
 *
 * 隐私（docs/extension-privacy.md）：临时导入区保存聊天正文，30 分钟 TTL
 * + 一次性消费 + 启动清扫；其余键全部只存结构信息与设置。
 */

import type {
  ExtImportPayload,
  ExportJob,
  ExportTarget,
  ExtQuickSettings,
} from './types'
import {
  DEFAULT_QUICK_SETTINGS,
} from './types'
import { SETTINGS_SCHEMA_VERSION } from './version'
import type { CustomTemplate } from '../../src/core/templates'
import type { HealthSnapshot } from './health'

export const IMPORT_TTL_MS = 30 * 60 * 1000 // 30 分钟
export const EXPORT_JOB_TTL_MS = 60 * 60 * 1000 // 导出任务 1 小时（正常几秒内消费）

const SETTINGS_KEY = 'markdoc.ext.quickSettings.v1'
const CUSTOM_TEMPLATES_KEY = 'markdoc.ext.customTemplates.v1'
const EXPORT_JOB_PREFIX = 'markdoc.ext.exportJob.'
const EXT_IMPORT_PREFIX = 'markdoc.ext.import.'
const HEALTH_SNAPSHOT_PREFIX = 'markdoc.ext.health.'
const LAST_EXPORT_KEY = 'markdoc.ext.lastExport'

// ─── 基础工具 ────────────────────────────────────────────────────────────────

/** chrome.storage.local 的 promise 化（SW / popup / content script 通用） */
export async function storageGet<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key)
  return result[key] as T | undefined
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function storageRemove(prefix: string): Promise<void> {
  await chrome.storage.local.remove(prefix)
}

/** 生成不可猜测的一次性 ID（URL 安全） */
export function randomId(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

// ─── 快速设置（schemaVersion + migration，P4C 第三十四节）─────────────────────

interface StoredQuickSettings extends ExtQuickSettings {
  schemaVersion?: number
}

/**
 * v1（无 schemaVersion 字段）→ v2：
 *   v1 与 v2 字段兼容；v2 补齐 schemaVersion 并对未知字段做白名单过滤，
 *   防止旧版本残留字段导致报错。未来加字段时在此追加 migration 步骤。
 */
function migrateSettings(raw: Record<string, unknown>): ExtQuickSettings {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
  // 白名单字段拷贝，忽略一切未知/损坏字段
  const merged: Record<string, unknown> = { ...DEFAULT_QUICK_SETTINGS }
  for (const key of Object.keys(DEFAULT_QUICK_SETTINGS) as Array<keyof ExtQuickSettings>) {
    const v = raw[key]
    if (v !== undefined && typeof v === typeof DEFAULT_QUICK_SETTINGS[key]) {
      merged[key] = v
    }
  }
  void version // 目前 v1/v2 字段同构；后续版本在此分派迁移
  const migrated = merged as unknown as ExtQuickSettings
  return migrateLegacyMarkdocUrl(migrated)
}

/**
 * P5A：MarkDoc Web 正式入口迁移到 GitHub Pages。
 * 老用户 storage 里存的失效 Netlify 地址自动切到默认值（用户自定义的其他地址不动）。
 */
function migrateLegacyMarkdocUrl(settings: ExtQuickSettings): ExtQuickSettings {
  if (/\.netlify\.app$/i.test(settings.markdocUrl)) {
    return { ...settings, markdocUrl: DEFAULT_QUICK_SETTINGS.markdocUrl }
  }
  return settings
}

export async function loadQuickSettings(): Promise<ExtQuickSettings> {
  try {
    const raw = await storageGet<StoredQuickSettings>(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_QUICK_SETTINGS }
    return migrateSettings(raw as unknown as Record<string, unknown>)
  } catch {
    return { ...DEFAULT_QUICK_SETTINGS }
  }
}

export async function saveQuickSettings(settings: ExtQuickSettings): Promise<void> {
  const stored: StoredQuickSettings = { ...settings, schemaVersion: SETTINGS_SCHEMA_VERSION }
  await storageSet(SETTINGS_KEY, stored)
}

// ─── TemplateStorage 统一接口（扩展侧实现，chrome.storage.local）─────────────

export interface TemplateStorage {
  listTemplates(): Promise<CustomTemplate[]>
  saveTemplate(template: CustomTemplate): Promise<void>
  getActiveTemplateId(): Promise<string>
  setActiveTemplateId(id: string): Promise<void>
}

export const extensionTemplateStorage: TemplateStorage = {
  async listTemplates() {
    const raw = await storageGet<CustomTemplate[]>(CUSTOM_TEMPLATES_KEY)
    return Array.isArray(raw) ? raw : []
  },
  async saveTemplate(template) {
    const list = await extensionTemplateStorage.listTemplates()
    const next = list.filter((t) => t.id !== template.id)
    next.push(template)
    await storageSet(CUSTOM_TEMPLATES_KEY, next)
  },
  async getActiveTemplateId() {
    const settings = await loadQuickSettings()
    return settings.templateId
  },
  async setActiveTemplateId(id) {
    const settings = await loadQuickSettings()
    settings.templateId = id
    await saveQuickSettings(settings)
  },
}

// ─── 导出任务暂存（带 expiresAt）─────────────────────────────────────────────

interface StagedEnvelope {
  payload: ExportJob
  createdAt: number
  expiresAt: number
}

export async function stageExportJob(job: ExportJob): Promise<string> {
  const id = randomId()
  const now = Date.now()
  const envelope: StagedEnvelope = {
    payload: job,
    createdAt: now,
    expiresAt: now + EXPORT_JOB_TTL_MS,
  }
  await storageSet(EXPORT_JOB_PREFIX + id, envelope)
  return id
}

export async function takeExportJob(id: string): Promise<ExportJob | null> {
  const key = EXPORT_JOB_PREFIX + id
  const envelope = await storageGet<StagedEnvelope | ExportJob>(key)
  await storageRemove(key)
  return reviveExportJob(envelope)
}

/** 旧版直接存 job 本体（无 envelope），读取时兜底兼容 */
function reviveExportJob(envelope: StagedEnvelope | ExportJob | undefined): ExportJob | null {
  if (!envelope) return null
  const job = 'payload' in (envelope as StagedEnvelope)
    ? (envelope as StagedEnvelope).payload
    : (envelope as ExportJob)
  const expiresAt = 'expiresAt' in (envelope as StagedEnvelope) && typeof (envelope as StagedEnvelope).expiresAt === 'number'
    ? (envelope as StagedEnvelope).expiresAt
    : ((envelope as ExportJob).createdAt ?? 0) + EXPORT_JOB_TTL_MS
  if (Date.now() > expiresAt) return null
  return job
}

// ─── 「在 MarkDoc 中编辑」临时导入区（30 分钟过期，一次性消费）───────────────

export async function stageImport(payload: Omit<ExtImportPayload, 'id' | 'createdAt'>): Promise<string> {
  const id = randomId()
  const now = Date.now()
  const full: ExtImportPayload & { expiresAt: number } = {
    ...payload,
    id,
    createdAt: now,
    expiresAt: now + IMPORT_TTL_MS,
  }
  await storageSet(EXT_IMPORT_PREFIX + id, full)
  await sweepExpiredData()
  return id
}

interface ImportEnvelope extends ExtImportPayload {
  expiresAt?: number
}

export async function takeImport(id: string): Promise<ExtImportPayload | null> {
  const key = EXT_IMPORT_PREFIX + id
  const payload = await storageGet<ImportEnvelope>(key)
  if (!payload) return null
  await storageRemove(key) // 一次性：无论是否过期，读走即删
  const expiresAt = payload.expiresAt ?? payload.createdAt + IMPORT_TTL_MS
  if (Date.now() > expiresAt) return null
  return payload
}

// ─── 过期清扫（启动 / onInstalled / 每次写入时）──────────────────────────────

export async function sweepExpiredData(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null)
    const now = Date.now()
    const expired = Object.keys(all).filter((key) => {
      if (!key.startsWith(EXT_IMPORT_PREFIX) && !key.startsWith(EXPORT_JOB_PREFIX)) return false
      const v = all[key] as { createdAt?: number; expiresAt?: number } | undefined
      if (!v) return true
      if (typeof v.expiresAt === 'number') return now > v.expiresAt
      // 旧格式：按 createdAt + TTL 推断
      const ttl = key.startsWith(EXT_IMPORT_PREFIX) ? IMPORT_TTL_MS : EXPORT_JOB_TTL_MS
      return now - (v.createdAt ?? 0) > ttl
    })
    if (expired.length > 0) await chrome.storage.local.remove(expired)
  } catch {
    // 清理失败不影响主流程
  }
}

// ─── Adapter 健康快照（DOM 改版检测基线）─────────────────────────────────────

export async function loadHealthSnapshot(hostname: string): Promise<HealthSnapshot | null> {
  try {
    return (await storageGet<HealthSnapshot>(HEALTH_SNAPSHOT_PREFIX + hostname)) ?? null
  } catch {
    return null
  }
}

export async function saveHealthSnapshot(hostname: string, snapshot: HealthSnapshot): Promise<void> {
  try {
    await storageSet(HEALTH_SNAPSHOT_PREFIX + hostname, snapshot)
  } catch { /* ignore */ }
}

// ─── 最近导出结果（诊断信息用；只存目标/结果/代码，不存内容）─────────────────

export interface LastExportRecord {
  target: ExportTarget
  ok: boolean
  errorCode?: string
  at: number
}

export async function recordExportResult(record: LastExportRecord): Promise<void> {
  try {
    await storageSet(LAST_EXPORT_KEY, record)
  } catch { /* ignore */ }
}

export async function loadLastExport(): Promise<LastExportRecord | null> {
  try {
    return (await storageGet<LastExportRecord>(LAST_EXPORT_KEY)) ?? null
  } catch {
    return null
  }
}
