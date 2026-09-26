import { getSupabase } from './client'

export interface AccountUser {
  id: string
  email: string
}

export type AuthResult = { ok: true } | { ok: false; message: string }

/** 密码规则：至少 8 位，包含字母和数字（需求 §3.2） */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return '密码至少 8 位'
  if (!/[A-Za-z]/.test(password)) return '密码必须包含字母'
  if (!/\d/.test(password)) return '密码必须包含数字'
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function validateEmail(email: string): string | null {
  if (!EMAIL_RE.test(email)) return '邮箱格式不正确'
  return null
}

/** Supabase 错误 → 用户可读文案（需求 UI/UX：错误提示要明确） */
function mapAuthError(err: unknown): string {
  const code = (err as { code?: string; message?: string }) ?? {}
  const msg = code.message ?? ''
  if (code.code === 'over_email_send_rate_limit' || msg.includes('rate limit')) {
    return '验证邮件发送过于频繁，请稍后再试（60 秒内仅 1 封，每日最多 10 封）'
  }
  if (code.code === 'user_banned') return '账号已被禁用，请联系管理员'
  if (msg.includes('Email not confirmed')) return '邮箱未验证，请先查收验证邮件后再登录'
  if (msg.includes('Invalid login credentials')) return '邮箱或密码错误'
  if (msg.includes('User already registered')) return '该邮箱已注册，请直接登录'
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) return '邮箱格式不正确'
  if (msg.includes('Password') && msg.includes('characters')) return '密码至少 8 位，包含字母和数字'
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '网络错误，请检查网络后重试'
  if (msg.includes('anonymous sign-ins')) return '当前未开放注册，请联系管理员'
  return msg || '操作失败，请稍后重试'
}

export async function getAuthUser(): Promise<AccountUser | null> {
  try {
    const supabase = await getSupabase()
    const { data } = await supabase.auth.getUser()
    if (!data.user) return null
    return { id: data.user.id, email: data.user.email ?? '' }
  } catch {
    return null
  }
}

export async function onAuthChange(cb: (user: AccountUser | null) => void): Promise<() => void> {
  const supabase = await getSupabase()
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null)
  })
  return () => data.subscription.unsubscribe()
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { ok: false, message: mapAuthError(error) }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: mapAuthError(err) }
  }
}

export async function signUp(
  email: string,
  password: string,
  consent: boolean,
  source: 'web' | 'extension' = 'web',
): Promise<AuthResult> {
  if (!consent) return { ok: false, message: '请先阅读并同意《隐私政策》与《服务条款》' }
  const pwError = validatePassword(password)
  if (pwError) return { ok: false, message: pwError }
  try {
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { source }, emailRedirectTo: `${location.origin}${location.pathname}` },
    })
    if (error) return { ok: false, message: mapAuthError(error) }
    // 关闭"自动确认"的正式环境：返回 session 为空，等待用户点验证链接
    if (data.session) return { ok: true }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: mapAuthError(err) }
  }
}

export async function sendPasswordReset(email: string): Promise<AuthResult> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname}`,
    })
    if (error) return { ok: false, message: mapAuthError(error) }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: mapAuthError(err) }
  }
}

/** 重置密码 / 修改密码（重置邮件回跳后处于恢复会话，直接 update） */
export async function updatePassword(newPassword: string): Promise<AuthResult> {
  const pwError = validatePassword(newPassword)
  if (pwError) return { ok: false, message: pwError }
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, message: mapAuthError(error) }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: mapAuthError(err) }
  }
}

/** 重新发送验证邮件（未登录场景按邮箱重发注册确认） */
export async function resendVerification(email: string): Promise<AuthResult> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) return { ok: false, message: mapAuthError(error) }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: mapAuthError(err) }
  }
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await getSupabase()
    await supabase.auth.signOut({ scope: 'global' }) // 登出所有设备
  } catch {
    /* 忽略：本地会话照常清除 */
  }
}
