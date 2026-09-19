/**
 * Adapter 注册表：按 hostname 选择平台 Adapter。
 * 新增平台：实现 ChatPlatformAdapter + 在此注册 + manifest matches 增加站点。
 */

import type { ChatPlatformAdapter } from '../types'
import { ChatGptAdapter } from './chatgpt'
import { DeepSeekAdapter } from './deepseek'
import { ClaudeAdapter } from './claude'
import { GeminiAdapter } from './gemini'
import { KimiAdapter } from './kimi'

const registry: ChatPlatformAdapter[] = [
  new ChatGptAdapter(),
  new DeepSeekAdapter(),
  new ClaudeAdapter(),
  new GeminiAdapter(),
  new KimiAdapter(),
]

export function detectAdapter(): ChatPlatformAdapter | null {
  for (const adapter of registry) {
    try {
      if (adapter.detect()) return adapter
    } catch {
      // adapter 检测失败不影响其它平台
    }
  }
  return null
}

export function getRegistry(): ChatPlatformAdapter[] {
  return registry
}
