/**
 * MarkDoc 管理员后台（甲方《管理员后台交付清单》前端实现）。
 *
 * 独立入口 admin.html，与主站共用 Tailwind，但完全独立于用户会话：
 *   - 登录走 admin-api（GoTrue 密码校验 + MFA TOTP + admin_sessions 2h）
 *   - 所有数据经 admin-api（service_role + 权限矩阵），前端只做展示与确认
 *   - 会话存 sessionStorage（关闭标签页即失效），登出吊销服务端会话
 *
 * 部署：任意静态托管同域 /admin.html；需配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。
 * 初始超管：见 docs/账号体系部署.md（SQL 创建 + admin_users.insert）。
 */
import { useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'

const SUPABASE_URL = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL ?? ''
const API = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/admin-api` : ''
const TOKEN_KEY = 'markdoc.admin.token'
const ME_KEY = 'markdoc.admin.me'

interface Me { adminId: string; role: string; permissions: string[] }

async function api<T = Record<string, unknown>>(action: string, params?: Record<string, unknown>): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? ''
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, params: params ?? {} }),
  })
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(ME_KEY)
    throw new Error('未登录或会话已过期（2 小时无操作自动登出）')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `请求失败（${res.status}）`)
  return body as T
}

const card = 'bg-white rounded-xl border border-gray-200 shadow-sm'
const th = 'text-left text-xs font-semibold text-gray-500 px-3 py-2 border-b border-gray-100'
const td = 'px-3 py-2 text-sm text-gray-700 border-b border-gray-50 align-top'
const btn = 'px-2.5 py-1 text-xs rounded-md border border-gray-300 hover:bg-gray-100 transition-colors whitespace-nowrap'
const btnDanger = 'px-2.5 py-1 text-xs rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap'
const input = 'rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/50'

function useConfirm() {
  return useCallback(async (message: string): Promise<boolean> => window.confirm(message), [])
}

// ── 页面：仪表盘 ─────────────────────────────────────────────────────────────
function Dashboard() {
  const [stats, setStats] = useState<Record<string, number | string | null> | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<Record<string, number>>('dashboard').then(setStats).catch((e) => setErr(e.message)) }, [])
  if (err) return <p className="text-sm text-red-500">{err}</p>
  if (!stats) return <p className="text-sm text-gray-400">加载中…</p>
  const items: Array<[string, string | number]> = [
    ['用户总数', stats.usersTotal as number],
    ['近 7 日新增', stats.usersNew7d as number],
    ['待验证邮箱', stats.usersUnverified as number],
    ['已禁用', stats.usersDisabled as number],
    ['匿名转换次数', stats.anonExports as number],
    ['注册转换次数', stats.userExports as number],
    ['转化率', stats.conversionRate != null ? `${stats.conversionRate}%` : '—'],
    ['云端历史总数', stats.historiesTotal as number],
    ['近 7 日邮件', stats.emails7d as number],
    ['邮件失败', stats.emailsFailed7d as number],
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map(([label, value]) => (
        <div key={label} className={`${card} p-4`}>
          <p className="text-xs text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
        </div>
      ))}
    </div>
  )
}

// ── 页面：用户管理 ───────────────────────────────────────────────────────────
function Users({ me, confirm }: { me: Me; confirm: (m: string) => Promise<boolean> }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api<{ rows: Array<Record<string, unknown>>; total: number }>('users.list', { q, status: status || undefined, page })
      setRows(r.rows); setTotal(r.total)
    } catch (e) { setErr((e as Error).message) }
  }, [q, status, page])
  useEffect(() => { void load() }, [load])

  const act = async (action: string, params: Record<string, unknown>, message?: string) => {
    if (message && !(await confirm(message))) return
    setBusy(true)
    try { await api(action, params); await load() } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const emailOf = (u: Record<string, unknown>) => String(u.email)
  const can = (p: string) => me.permissions.includes(p)

  return (
    <div>
      <div className="flex gap-2 mb-3 items-center flex-wrap">
        <input className={input} placeholder="搜索邮箱…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <select className={input} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">已禁用</option>
        </select>
        <span className="text-xs text-gray-400">共 {total} 个</span>
      </div>
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[860px]">
          <thead><tr><th className={th}>邮箱</th><th className={th}>状态</th><th className={th}>验证</th><th className={th}>导出次数</th><th className={th}>注册时间</th><th className={th}>操作</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={String(u.id)}>
                <td className={td}>{emailOf(u)}</td>
                <td className={td}>{u.status === 'disabled' ? <span className="text-red-500">已禁用</span> : '正常'}</td>
                <td className={td}>{u.emailVerified ? '✓' : <span className="text-amber-500">未验证</span>}</td>
                <td className={td}>{String(u.export_count)}</td>
                <td className={td}>{new Date(String(u.created_at)).toLocaleDateString()}</td>
                <td className={td}>
                  <span className="flex gap-1.5 flex-wrap">
                    <button className={btn} disabled={busy} onClick={() => act('user.setStatus', { id: u.id, disabled: u.status !== 'disabled' }, u.status === 'disabled' ? '启用该用户？' : '禁用该用户？将同时强制下线')}>{u.status === 'disabled' ? '启用' : '禁用'}</button>
                    {can('user.force_logout') && <button className={btn} disabled={busy} onClick={() => act('user.forceLogout', { id: u.id }, '强制该用户下线所有设备？')}>强制下线</button>}
                    {can('user.reset_password') && <button className={btn} disabled={busy} onClick={() => act('user.resetPassword', { id: u.id, email: emailOf(u) }, `向 ${emailOf(u)} 发送密码重置邮件？`)}>重置密码</button>}
                    {can('user.resend_verification') && !u.emailVerified && <button className={btn} disabled={busy} onClick={() => act('user.resendVerification', { email: emailOf(u) }, `重发验证邮件到 ${emailOf(u)}？`)}>重发验证</button>}
                    {can('user.export_data') && <button className={btn} disabled={busy} onClick={async () => {
                      const d = await api<Record<string, unknown>>('user.exportData', { id: u.id })
                      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
                      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `user-${u.id}.json`; a.click()
                    }}>导出数据</button>}
                    {can('user.delete') && <button className={btnDanger} disabled={busy} onClick={() => act('user.delete', { id: u.id }, `永久删除用户 ${emailOf(u)}？该操作不可恢复（含其全部云端历史）。`)}>删除</button>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-3 items-center text-sm">
        <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span className="text-xs text-gray-400">第 {page} 页</span>
        <button className={btn} disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button>
      </div>
    </div>
  )
}

// ── 页面：历史记录管理 ───────────────────────────────────────────────────────
function Histories({ me, confirm }: { me: Me; confirm: (m: string) => Promise<boolean> }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [q, setQ] = useState('')
  const [userId, setUserId] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      const r = await api<{ rows: Array<Record<string, unknown>>; total: number }>('histories.list', { q: q || undefined, userId: userId || undefined, page })
      setRows(r.rows); setTotal(r.total)
    } catch (e) { setErr((e as Error).message) }
  }, [q, userId, page])
  useEffect(() => { void load() }, [load])

  const canViewContent = me.permissions.includes('history.content')
  return (
    <div>
      <div className="flex gap-2 mb-3 items-center flex-wrap">
        <input className={input} placeholder="按标题搜索…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <input className={input} placeholder="按用户 ID 过滤" value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1) }} size={40} />
        <span className="text-xs text-gray-400">共 {total} 条</span>
      </div>
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      <p className="text-xs text-gray-400 mb-2">元数据对普通管理员可见；正文仅超级管理员可查看，且每次查看均写入审计日志。</p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[760px]">
          <thead><tr><th className={th}>标题</th><th className={th}>用户</th><th className={th}>格式</th><th className={th}>大小</th><th className={th}>时间</th><th className={th}>操作</th></tr></thead>
          <tbody>
            {rows.map((h) => (
              <tr key={String(h.id)}>
                <td className={td}>{String(h.title)}</td>
                <td className={`${td} font-mono text-xs`}>{String(h.user_id).slice(0, 8)}…</td>
                <td className={td}>{String(h.format).toUpperCase()}</td>
                <td className={td}>{h.options && typeof h.options === 'object' ? '—' : '—'}</td>
                <td className={td}>{new Date(String(h.created_at)).toLocaleString()}</td>
                <td className={td}>
                  <span className="flex gap-1.5">
                    {canViewContent && (
                      <button className={btn} onClick={async () => {
                        const d = await api<Record<string, unknown>>('history.get', { id: h.id })
                        const w2 = window.open('', '_blank')
                        w2?.document.write(`<pre>${String(d.content_md ?? '').replace(/</g, '&lt;')}</pre>`)
                        w2?.document.close()
                      }}>查看正文</button>
                    )}
                    <button className={btnDanger} onClick={async () => {
                      if (!(await confirm('删除该条历史（软删除）？'))) return
                      await api('history.delete', { id: h.id }); await load()
                    }}>删除</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-3 items-center text-sm">
        <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span className="text-xs text-gray-400">第 {page} 页</span>
        <button className={btn} disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button>
        {me.permissions.includes('history.clear_user') && userId && (
          <button className={btnDanger} onClick={async () => {
            if (!(await confirm(`清空用户 ${userId} 的全部云端历史？`))) return
            await api('history.clearUser', { userId }); await load()
          }}>按用户清空</button>
        )}
      </div>
    </div>
  )
}

// ── 页面：邮件日志 ───────────────────────────────────────────────────────────
function Emails({ confirm }: { confirm: (m: string) => Promise<boolean> }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      const r = await api<{ rows: Array<Record<string, unknown>>; total: number }>('emailLogs.list', { page })
      setRows(r.rows); setTotal(r.total)
    } catch (e) { setErr((e as Error).message) }
  }, [page])
  useEffect(() => { void load() }, [load])
  return (
    <div>
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      <p className="text-xs text-gray-400 mb-2">只记录收件人/类型/状态/失败原因，不记录验证码或链接令牌明文。</p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[700px]">
          <thead><tr><th className={th}>收件人</th><th className={th}>类型</th><th className={th}>状态</th><th className={th}>失败原因</th><th className={th}>时间</th><th className={th}>操作</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td className={td}>{String(r.to_email)}</td>
                <td className={td}>{String(r.type)}</td>
                <td className={td}>{r.status === 'sent' ? <span className="text-emerald-600">已发送</span> : <span className="text-red-500">失败</span>}</td>
                <td className={`${td} text-xs text-gray-400 max-w-[280px] break-all`}>{String(r.error ?? '—')}</td>
                <td className={td}>{new Date(String(r.created_at)).toLocaleString()}</td>
                <td className={td}><button className={btn} onClick={async () => {
                  if (!(await confirm(`重发 ${r.type} 邮件到 ${r.to_email}？`))) return
                  try { await api('emailLogs.resend', { id: r.id }); alert('已重发') } catch (e) { alert((e as Error).message) }
                }}>重发</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-3 items-center text-sm">
        <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span className="text-xs text-gray-400">第 {page} 页</span>
        <button className={btn} disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button>
      </div>
    </div>
  )
}

// ── 页面：系统配置 ───────────────────────────────────────────────────────────
function Config() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')
  const load = useCallback(async () => {
    try {
      const r = await api<{ rows: Array<Record<string, unknown>> }>('config.get')
      setRows(r.rows)
    } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])
  const LABELS: Record<string, string> = {
    free_full_uses: '匿名设备终身免费次数', ip_daily_extra: '同 IP 每日额外放行',
    history_retention_days: '云端历史保留天数', registered_unlimited: '注册用户不限次',
    registration_open: '开放注册', force_email_verify: '强制邮箱验证',
    session_days: '用户会话天数', maintenance_mode: '维护模式', announcement: '公告',
  }
  return (
    <div className="max-w-xl">
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      <p className="text-xs text-gray-400 mb-3">修改立即生效（导出执法实时读取）；每次修改写审计日志。仅超级管理员可访问本页。</p>
      <div className={`${card} divide-y divide-gray-50`}>
        {rows.map((r, i) => (
          <div key={String(r.key)} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700">{LABELS[String(r.key)] ?? String(r.key)}</p>
              <p className="text-xs font-mono text-gray-400">{String(r.key)}</p>
            </div>
            <input
              className={`${input} w-40`}
              value={String((r.value as { v?: unknown }).v ?? r.value ?? '').replace(/^(true|false)$/, '$1')}
              onChange={(e) => {
                const next = [...rows]
                let v: unknown = e.target.value
                if (v === 'true') v = true
                else if (v === 'false') v = false
                else if (/^\d+$/.test(String(v))) v = Number(v)
                next[i] = { ...r, value: v }
                setRows(next)
              }}
            />
            <button className={btn} onClick={async () => {
              try { await api('config.set', { key: r.key, value: r.value }); setSaved(String(r.key)); setTimeout(() => setSaved(''), 1500) } catch (e) { alert((e as Error).message) }
            }}>{saved === r.key ? '✓ 已保存' : '保存'}</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 页面：审计日志 ───────────────────────────────────────────────────────────
function Audit() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      const r = await api<{ rows: Array<Record<string, unknown>>; total: number }>('audit.list', { page })
      setRows(r.rows); setTotal(r.total)
    } catch (e) { setErr((e as Error).message) }
  }, [page])
  useEffect(() => { void load() }, [load])
  return (
    <div>
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      <p className="text-xs text-gray-400 mb-2">审计日志只追加：数据库层已 REVOKE UPDATE/DELETE，任何角色（含超级管理员）都无法修改或删除。保留 180 天（cleanup 函数按配置清理）。</p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[720px]">
          <thead><tr><th className={th}>时间</th><th className={th}>管理员</th><th className={th}>动作</th><th className={th}>对象</th><th className={th}>详情</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td className={td}>{new Date(String(r.created_at)).toLocaleString()}</td>
                <td className={`${td} font-mono text-xs`}>{r.admin_id ? String(r.admin_id).slice(0, 8) + '…' : '（用户自助）'}</td>
                <td className={td}>{String(r.action)}</td>
                <td className={`${td} font-mono text-xs`}>{String(r.target ?? '—')}</td>
                <td className={`${td} text-xs text-gray-400 max-w-[260px] break-all`}>{r.detail ? JSON.stringify(r.detail) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-3 items-center text-sm">
        <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span className="text-xs text-gray-400">第 {page} 页</span>
        <button className={btn} disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button>
      </div>
    </div>
  )
}

// ── 页面：管理员管理 ─────────────────────────────────────────────────────────
function Admins({ me, confirm }: { me: Me; confirm: (m: string) => Promise<boolean> }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [err, setErr] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const load = useCallback(async () => {
    try {
      const r = await api<{ rows: Array<Record<string, unknown>> }>('admins.list')
      setRows(r.rows)
    } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])
  return (
    <div className="max-w-3xl">
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      <p className="text-xs text-gray-400 mb-3">管理员账号不开放注册，全部由此页创建；初始密码至少 12 位，首次登录提示修改。仅超级管理员可访问。</p>
      <div className={`${card} p-4 mb-4 flex gap-2 items-end flex-wrap`}>
        <div><p className="text-xs text-gray-400 mb-1">邮箱</p><input className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><p className="text-xs text-gray-400 mb-1">初始密码（≥12 位）</p><input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div><p className="text-xs text-gray-400 mb-1">角色</p>
          <select className={input} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">普通管理员</option>
            <option value="auditor">审计员</option>
            <option value="super">超级管理员</option>
          </select>
        </div>
        <button className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700" onClick={async () => {
          if (!(await confirm(`创建管理员 ${email}（${role}）？`))) return
          try { await api('admins.create', { email, password, role }); setEmail(''); setPassword(''); await load() } catch (e) { alert((e as Error).message) }
        }}>创建管理员</button>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full">
          <thead><tr><th className={th}>ID</th><th className={th}>角色</th><th className={th}>状态</th><th className={th}>创建时间</th><th className={th}>操作</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={String(a.id)}>
                <td className={`${td} font-mono text-xs`}>{String(a.id).slice(0, 8)}…{String(a.id) === me.adminId ? '（我）' : ''}</td>
                <td className={td}>{String(a.role_key)}</td>
                <td className={td}>{a.is_active ? '正常' : <span className="text-red-500">已禁用</span>}</td>
                <td className={td}>{new Date(String(a.created_at)).toLocaleDateString()}</td>
                <td className={td}>
                  <span className="flex gap-1.5">
                    {String(a.id) !== me.adminId && (
                      <>
                        <button className={btn} onClick={async () => {
                          if (!(await confirm(a.is_active ? '禁用该管理员？将吊销其全部会话。' : '启用该管理员？'))) return
                          try { await api('admins.setActive', { id: a.id, active: !a.is_active }); await load() } catch (e) { alert((e as Error).message) }
                        }}>{a.is_active ? '禁用' : '启用'}</button>
                        <button className={btnDanger} onClick={async () => {
                          if (!(await confirm('永久删除该管理员账号？'))) return
                          try { await api('admins.delete', { id: a.id }); await load() } catch (e) { alert((e as Error).message) }
                        }}>删除</button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 登录页 & 外壳 ────────────────────────────────────────────────────────────
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const r = await api<{ token: string; role: string; permissions: string[] }>('login', { email, password, totp: totp || undefined })
      sessionStorage.setItem(TOKEN_KEY, r.token)
      sessionStorage.setItem(ME_KEY, JSON.stringify({ adminId: '', role: r.role, permissions: r.permissions }))
      onDone()
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('两步验证')) setNeedTotp(true)
      setErr(msg)
    } finally { setBusy(false) }
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-lg font-bold text-gray-800 mb-1">MarkDoc 管理后台</h1>
        <p className="text-xs text-gray-400 mb-6">管理员独立入口 · 2 小时会话 · 失败锁定 · 2FA</p>
        <div className="space-y-3">
          <input className={`${input} w-full`} placeholder="管理员邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={`${input} w-full`} type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
          {needTotp && <input className={`${input} w-full`} placeholder="2FA 验证码（TOTP）" value={totp} onChange={(e) => setTotp(e.target.value)} />}
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button className={`${btn} w-full !py-2 bg-blue-600 !text-white !border-blue-600 hover:!bg-blue-700`} disabled={busy} onClick={() => void submit()}>
            {busy ? '登录中…' : '登录'}
          </button>
        </div>
      </div>
    </div>
  )
}

const PAGES: Array<[string, string]> = [
  ['dashboard', '📊 仪表盘'], ['users', '👥 用户管理'], ['histories', '🗂 历史记录'],
  ['emails', '📧 邮件日志'], ['config', '⚙️ 系统配置'], ['audit', '🛡 审计日志'], ['admins', '🔑 管理员'],
]

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [tab, setTab] = useState('dashboard')
  const confirm = useConfirm()
  useEffect(() => {
    // 会话心跳：2 小时无操作由服务端自动过期，这里每次切换页签校验一次
    api('me').catch(() => onLogout())
  }, [tab, onLogout])
  const visible = PAGES.filter(([key]) => {
    if (key === 'config' || key === 'admins') return me.permissions.includes('config.edit') || me.permissions.includes('admin.manage')
    if (key === 'audit') return me.permissions.includes('audit.view')
    return true
  })
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-52 shrink-0 bg-white border-r border-gray-200 p-3 flex flex-col gap-1">
        <p className="text-base font-bold text-gray-800 px-2 py-2 mb-2">MarkDoc 后台</p>
        {visible.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${tab === key ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <p className="text-[11px] text-gray-400 px-3">角色：{me.role}</p>
        <button onClick={() => void api('logout').catch(() => undefined).then(onLogout)} className="text-left text-sm text-gray-500 hover:text-red-500 px-3 py-2">
          🚪 退出登录
        </button>
      </aside>
      <main className="flex-1 p-6 overflow-x-auto">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'users' && <Users me={me} confirm={confirm} />}
        {tab === 'histories' && <Histories me={me} confirm={confirm} />}
        {tab === 'emails' && <Emails confirm={confirm} />}
        {tab === 'config' && <Config />}
        {tab === 'audit' && <Audit />}
        {tab === 'admins' && <Admins me={me} confirm={confirm} />}
      </main>
    </div>
  )
}

function AdminApp() {
  const [me, setMe] = useState<Me | null>(() => {
    try {
      const raw = sessionStorage.getItem(ME_KEY)
      return raw ? (JSON.parse(raw) as Me) : null
    } catch { return null }
  })
  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(ME_KEY)
    setMe(null)
  }, [])
  if (!SUPABASE_URL) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-md text-sm text-gray-600">
          <p className="font-bold text-gray-800 mb-2">后台未配置</p>
          <p>需在部署环境设置 <code className="font-mono text-xs">VITE_SUPABASE_URL</code> 与 <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code>，并部署 admin-api Edge Function（见 docs/账号体系部署.md）。</p>
        </div>
      </div>
    )
  }
  return me ? <Shell me={me} onLogout={logout} /> : <Login onDone={() => window.location.reload()} />
}

createRoot(document.getElementById('admin-root')!).render(<AdminApp />)
