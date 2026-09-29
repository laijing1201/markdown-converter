/**
 * 管理员邮件发送（Resend HTTP API）。
 *
 * 设计约束（甲方验收：邮件日志不记录验证码明文）：
 *   - 邮件正文只包含「操作链接」，验证/重置的令牌永远在链接里，不落库
 *   - 每次发送结果写入 email_logs（to_email / type / status / error）
 *   - 未配置 RESEND_API_KEY 时返回 failed（日志如实记录「邮件服务未配置」），
 *     绝不伪造「已发送」
 */
export interface MailSendResult {
  ok: boolean
  error?: string
}

const FROM = Deno.env.get('MAIL_FROM') ?? 'MarkDoc <noreply@markdoc.example>'

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  logType: 'signup' | 'reset' | 'admin_broadcast',
  log: (type: string, status: 'sent' | 'failed', error?: string) => Promise<void>,
): Promise<MailSendResult> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    await log(logType, 'failed', '邮件服务未配置（RESEND_API_KEY 缺失）')
    return { ok: false, error: '邮件服务未配置' }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      await log(logType, 'failed', `Resend ${res.status}: ${body.slice(0, 200)}`)
      return { ok: false, error: `Resend ${res.status}` }
    }
    await log(logType, 'sent')
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await log(logType, 'failed', msg.slice(0, 200))
    return { ok: false, error: msg }
  }
}
