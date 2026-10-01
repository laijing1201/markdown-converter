/**
 * Options 页逻辑（P4C 第二十四节）：
 *   只暴露导出默认值（格式/模板/包含项/目录/页码/网页版地址），
 *   复杂排版设置仍在 MarkDoc 网页版 —— 不把网页版全部设置复制过来。
 */

import { loadQuickSettings, saveQuickSettings } from './src/storage'
import { TEMPLATE_CONFIGS, TEMPLATE_ORDER, type TemplateId } from '../src/core/templates'
import { extensionTemplateStorage } from './src/storage'
import { EXT_VERSION } from './src/version'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

async function main(): Promise<void> {
  const quick = await loadQuickSettings()
  $('ver').textContent = EXT_VERSION

  // 模板下拉：系统 + 自定义
  const select = $('opt-template') as HTMLSelectElement
  select.innerHTML = ''
  for (const id of TEMPLATE_ORDER) {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = TEMPLATE_CONFIGS[id as TemplateId].name
    select.appendChild(opt)
  }
  for (const t of await extensionTemplateStorage.listTemplates()) {
    const opt = document.createElement('option')
    opt.value = t.id
    opt.textContent = `${t.name}（自定义）`
    select.appendChild(opt)
  }
  select.value = quick.templateId
  select.addEventListener('change', async () => {
    quick.templateId = select.value
    await saveQuickSettings(quick)
  })

  // 默认格式
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="opt-target"]')
  radios.forEach((r) => {
    r.checked = r.value === quick.defaultTarget
    r.addEventListener('change', async () => {
      if (r.checked) {
        quick.defaultTarget = r.value as 'docx' | 'pdf'
        await saveQuickSettings(quick)
      }
    })
  })

  // 整段对话风格
  const style = $('opt-style') as HTMLSelectElement
  style.value = quick.conversationStyle
  style.addEventListener('change', async () => {
    quick.conversationStyle = style.value as typeof quick.conversationStyle
    await saveQuickSettings(quick)
  })

  // 开关
  const bind = (id: string, key: keyof typeof quick) => {
    const el = $(id) as HTMLInputElement
    el.checked = Boolean(quick[key])
    el.addEventListener('change', async () => {
      ;(quick as unknown as Record<string, unknown>)[key] = el.checked
      await saveQuickSettings(quick)
    })
  }
  bind('opt-user-messages', 'includeUserMessages')
  bind('opt-sources', 'includeSources')
  bind('opt-toc', 'includeToc')
  bind('opt-pagenum', 'includePageNumbers')

  // 网页版地址
  const url = $('opt-markdoc-url') as HTMLInputElement
  url.value = quick.markdocUrl
  url.addEventListener('change', async () => {
    if (/^https?:\/\//.test(url.value.trim())) {
      quick.markdocUrl = url.value.trim()
      await saveQuickSettings(quick)
    } else {
      url.value = quick.markdocUrl
    }
  })

  // 快捷键设置页
  $('link-shortcuts').addEventListener('click', (e) => {
    e.preventDefault()
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
  })

  // 隐私说明（仓库 docs）
  $('link-privacy').addEventListener('click', (e) => {
    e.preventDefault()
    chrome.tabs.create({ url: 'https://github.com/laijing1201/markdown-converter/blob/main/docs/guides/extension-privacy.md' })
  })
}

void main()
