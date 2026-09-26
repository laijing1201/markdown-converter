/**
 * 匿名设备识别（服务端计次的辅助维度之一）：
 *   - deviceId：随机 UUID，存 localStorage（清除缓存即失效 → 由同 IP 日限额兜底）
 *   - fingerprint：UA/语言/屏幕/时区等稳定特征拼接后交给服务端做 SHA-256 哈希
 * 服务端另以请求 IP 计数（IP 不在前端参与），三者共同满足需求的识别方式要求。
 */

const DEVICE_KEY = 'markdoc.device.id'

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    // 隐私模式等 localStorage 不可用：会话内临时 ID（每次刷新重置 → 走 IP 限额）
    return `ephemeral-${crypto.randomUUID()}`
  }
}

function fingerprintRaw(): string {
  return [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    String(navigator.hardwareConcurrency ?? 0),
    String(navigator.maxTouchPoints ?? 0),
  ].join('|')
}

/** 原始特征串（服务端加盐哈希后入库，原文不落库） */
export function getFingerprint(): string {
  return fingerprintRaw()
}
