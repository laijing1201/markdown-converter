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

const inputCls =
  'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500/60'
const btnPrimary =
  'w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors'
const linkBtn = 'text-blue-600 dark:text-blue-400 hover:underline text-xs cursor-pointer'

/**
 * 注册 / 登录 / 重置密码弹窗。风格与现有弹窗体系一致（Tailwind + 暗色适配）。
 * 需求映射：错误提示逐条明确（邮箱未验证/密码错误/发送频繁/网络错误）；
 * 注册需勾选隐私政策与服务条款；验证邮件 60 秒冷却（客户端节流 + 服务端频控）。
 */
export default function AuthModal({ open, initialMode, banner, resumeTarget, onClose, onAuthed }: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    }
  }, [open, initialMode, banner])

  useEffect(() => {
    if (resendLeft <= 0) return
    const t = setTimeout(() => setResendLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendLeft])

  if (!open) return null

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 transition-colors">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {mode === 'login' ? '登录 MarkDoc' : mode === 'register' ? '注册 MarkDoc 账号' : '重置密码'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none" title="关闭">×</button>
          </div>
          {banner && <p className="mt-2 text-xs rounded-lg bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-3 py-2">{banner}</p>}
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-1 text-xs">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); setInfo('') }}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  mode === m
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {m === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          {info && <p className="text-xs rounded-lg bg-green-50 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-3 py-2">{info}</p>}

          <input
            className={inputCls}
            type="email"
            placeholder="邮箱地址"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {mode !== 'reset' && (
            <input
              className={inputCls}
              type="password"
              placeholder={mode === 'register' ? '设置密码（至少 8 位，含字母和数字）' : '密码'}
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          )}

          {error && <p className="text-xs rounded-lg bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-300 px-3 py-2">{error}</p>}

          {mode === 'register' && (
            <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300 select-none">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-blue-600" />
              <span>
                我已阅读并同意
                <a href="./privacy.html" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">《隐私政策》</a>
                与
                <a href="./terms.html" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">《服务条款》</a>
                （邮箱仅用于账号验证与找回密码，可随时注销并删除数据）
              </span>
            </label>
          )}

          <button className={btnPrimary} disabled={busy} onClick={submit}>
            {busy ? '处理中…' : mode === 'login' ? '登录' : mode === 'register' ? '注册并获取验证邮件' : '发送重置邮件'}
          </button>

          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            {mode === 'login' ? (
              <button className={linkBtn} onClick={() => { setMode('reset'); setError(''); setInfo('') }}>忘记密码？</button>
            ) : (
              <button className={linkBtn} onClick={() => { setMode('login'); setError(''); setInfo('') }}>返回登录</button>
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
