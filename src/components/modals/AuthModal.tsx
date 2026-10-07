import { useEffect, useRef, useState } from 'react'
import {
  resendVerification,
  sendPasswordReset,
  signIn,
  signUp,
  validateEmail,
  validatePassword,
  type AuthResult,
} from '../../core/account'

export type AuthModalMode = 'login' | 'register' | 'reset'

interface AuthModalProps {
  open: boolean
  initialMode: AuthModalMode
  /** 弹窗顶栏说明（如配额用完提示），不传则不显示 */
  banner?: string
  /** 登录成功后要恢复的导出动作 */
  resumeTarget?: 'docx' | 'pdf' | null
  onClose: () => void
  /** 登录成功回调（携带恢复目标） */
  onAuthed: (resumeTarget: 'docx' | 'pdf' | null) => void
}

/* ── 内联小图标（与项目惯例一致，不引入图标库） ─────────────────────────── */

const Icon = ({ d, className = 'h-4 w-4' }: { d: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {d}
  </svg>
)
const MailIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d={<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7.5 7.3 5a2 2 0 0 0 2.4 0l7.3-5" /></>} />
)
const LockIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d={<><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" /><path d="M8 10.5v-3a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15.2" r="1" fill="currentColor" stroke="none" /></>} />
)
const EyeIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d={<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>} />
)
const EyeOffIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d={<><path d="m3 3 18 18" /><path d="M10.7 5.7c.4-.1.9-.2 1.3-.2 6 0 9.5 6.5 9.5 6.5a17.9 17.9 0 0 1-2.3 3.1M6.6 6.7A16.5 16.5 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.4 3.9-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>} />
)
const AlertIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d={<><circle cx="12" cy="12" r="9" /><path d="M12 7.5V13" /><path d="M12 16.5h.01" /></>} />
)
const CheckIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d={<><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.4 2.4 4.6-5.3" /></>} />
)
const CloseIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d={<path d="M6 6l12 12M18 6 6 18" />} />
)

/* ── 样式常量 ─────────────────────────────────────────────────────────────── */

const inputCls =
  'w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 py-2.5 pl-10 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none transition-all duration-200 focus:border-violet-400 dark:focus:border-violet-500 focus:bg-white dark:focus:bg-gray-900 focus:ring-4 focus:ring-violet-500/10'
const inputPwCls = inputCls.replace('pr-3', 'pr-10')
const btnPrimary =
  'flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-violet-500/40 hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none'
const linkBtn =
  'cursor-pointer text-violet-600 transition-colors hover:text-violet-700 hover:underline hover:underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline dark:text-violet-400 dark:hover:text-violet-300'

/** 错误 / 成功 / 横幅提示的统一外框 */
function Callout({ tone, children }: { tone: 'error' | 'info' | 'banner'; children: React.ReactNode }) {
  const tones = {
    error: 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300',
    info: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    banner: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  } as const
  const icons = { error: <AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />, info: <CheckIcon className="mt-px h-3.5 w-3.5 shrink-0" />, banner: <AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" /> }
  return (
    <p className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${tones[tone]}`}>
      {icons[tone]}
      <span>{children}</span>
    </p>
  )
}

/**
 * 注册 / 登录 / 重置密码弹窗。视觉与 Landing 的品牌渐变（indigo→violet→fuchsia）统一。
 * 需求映射：错误提示逐条明确（邮箱未验证/密码错误/发送频繁/网络错误）；
 * 注册需勾选隐私政策与服务条款；验证邮件 60 秒冷却（客户端节流 + 服务端频控）。
 */
export default function AuthModal({ open, initialMode, banner, resumeTarget, onClose, onAuthed }: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [resendLeft, setResendLeft] = useState(0)
  const emailRef = useRef(email)
  emailRef.current = email

  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setError(banner ?? '')
      setInfo('')
      setPassword('')
      setShowPw(false)
    }
  }, [open, initialMode, banner])

  useEffect(() => {
    if (resendLeft <= 0) return
    const t = setTimeout(() => setResendLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendLeft])

  if (!open) return null

  const title = mode === 'login' ? '欢迎回来' : mode === 'register' ? '创建账号' : '重置密码'
  const subtitle =
    mode === 'login'
      ? '登录 MarkDoc 账号，继续你的创作'
      : mode === 'register'
        ? '注册后可云端同步历史与导出文档'
        : '输入注册邮箱，我们将发送重置链接'

  const apply = (r: AuthResult): boolean => {
    if (!r.ok) {
      setError(r.message)
      return false
    }
    return true
  }

  const handleLogin = async () => {
    setError('')
    if (!validateEmail(email)) return setError('邮箱格式不正确')
    if (!password) return setError('请输入密码')
    setBusy(true)
    const r = await signIn(email, password)
    setBusy(false)
    if (apply(r)) {
      onClose()
      onAuthed(resumeTarget ?? null)
    }
  }

  const handleRegister = async () => {
    setError('')
    setInfo('')
    if (!validateEmail(email)) return setError('邮箱格式不正确')
    const pwErr = validatePassword(password)
    if (pwErr) return setError(pwErr)
    if (!consent) return setError('请先阅读并勾选同意《隐私政策》与《服务条款》')
    setBusy(true)
    const r = await signUp(email, password, consent)
    setBusy(false)
    if (apply(r)) {
      setInfo('验证邮件已发送，请查收邮箱（含垃圾箱）完成验证后登录。链接 10 分钟内有效。')
      setResendLeft(60)
    }
  }

  const handleReset = async () => {
    setError('')
    setInfo('')
    if (!validateEmail(email)) return setError('邮箱格式不正确')
    setBusy(true)
    const r = await sendPasswordReset(email)
    setBusy(false)
    if (apply(r)) setInfo('重置密码邮件已发送，请查收邮箱按指引设置新密码（旧密码将失效）。')
  }

  const handleResend = async () => {
    if (resendLeft > 0) return
    setError('')
    setBusy(true)
    const r = await resendVerification(emailRef.current)
    setBusy(false)
    if (apply(r)) {
      setInfo('验证邮件已重新发送，请查收。')
      setResendLeft(60)
    }
  }

  const submit = () => {
    if (mode === 'login') void handleLogin()
    else if (mode === 'register') void handleRegister()
    else void handleReset()
  }

  const switchMode = (m: AuthModalMode) => {
    setMode(m)
    setError('')
    setInfo('')
  }

  return (
    <div
      className="app-fade-in fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4 backdrop-blur-sm dark:bg-black/70"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-pop relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl shadow-violet-950/25 ring-1 ring-gray-900/5 dark:bg-gray-800 dark:ring-white/10">
        {/* 顶部品牌光晕 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-violet-500/10 to-transparent dark:from-violet-400/[0.07]" />

        <button
          onClick={onClose}
          title="关闭"
          aria-label="关闭"
          className="absolute right-3.5 top-3.5 z-10 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        {/* 品牌头部 */}
        <div className="relative px-6 pt-6 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-bold text-white shadow-lg shadow-violet-500/30">
            M
          </span>
          <h2 className="mt-3 text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>

        <div className="relative space-y-3.5 px-6 pb-6 pt-5">
          {banner && <Callout tone="banner">{banner}</Callout>}

          {/* 登录 / 注册 分段切换 */}
          {mode !== 'reset' && (
            <div className="relative flex rounded-xl bg-gray-100 p-1 dark:bg-gray-900/70">
              <span
                aria-hidden
                className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-white shadow-sm ring-1 ring-gray-900/5 transition-transform duration-200 ease-out dark:bg-gray-700 dark:ring-white/10 ${
                  mode === 'register' ? 'translate-x-full' : 'translate-x-0'
                }`}
              />
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`relative z-10 flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors duration-200 ${
                    mode === m
                      ? 'text-violet-600 dark:text-white'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {m === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>
          )}

          {/* 邮箱 */}
          <div className="relative">
            <MailIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              className={inputCls}
              type="email"
              placeholder="邮箱地址"
              value={email}
              autoComplete="email"
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>

          {/* 密码 */}
          {mode !== 'reset' && (
            <div className="relative">
              <LockIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                className={inputPwCls}
                type={showPw ? 'text' : 'password'}
                placeholder={mode === 'register' ? '设置密码（至少 8 位，字母+数字）' : '密码'}
                value={password}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                title={showPw ? '隐藏密码' : '显示密码'}
                aria-label={showPw ? '隐藏密码' : '显示密码'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                {showPw ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
            </div>
          )}

          {error && <Callout tone="error">{error}</Callout>}

          {mode === 'register' && (
            <label className="flex cursor-pointer select-none items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2.5 text-xs leading-relaxed text-gray-600 transition-colors hover:border-violet-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 dark:hover:border-violet-700">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded accent-violet-600" />
              <span>
                我已阅读并同意
                <a href="./privacy.html" target="_blank" rel="noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">《隐私政策》</a>
                与
                <a href="./terms.html" target="_blank" rel="noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">《服务条款》</a>
                <span className="mt-0.5 block text-gray-400 dark:text-gray-500">邮箱仅用于账号验证与找回密码，可随时注销并删除数据</span>
              </span>
            </label>
          )}

          <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>
            {busy && <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {busy ? '处理中…' : mode === 'login' ? '登录' : mode === 'register' ? '注册并获取验证邮件' : '发送重置邮件'}
          </button>

          {info && <Callout tone="info">{info}</Callout>}

          <div className="flex items-center justify-between pt-0.5 text-xs">
            {mode === 'login' ? (
              <button className={linkBtn} onClick={() => switchMode('reset')}>忘记密码？</button>
            ) : (
              <button className={linkBtn} onClick={() => switchMode('login')}>返回登录</button>
            )}
            {mode === 'register' && info && (
              <button className={linkBtn} disabled={resendLeft > 0} onClick={handleResend}>
                {resendLeft > 0 ? `重新发送（${resendLeft}s）` : '重新发送验证邮件'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
