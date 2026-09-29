import { useState } from 'react'
import { updatePassword, signOut, exportAccountData, deleteAccount, validatePassword, type AccountUser } from '../../core/account'

interface AccountModalProps {
  user: AccountUser
  onClose: () => void
  onToast: (icon: string, message: string) => void
  /** 注销成功后的收尾（清登录态、提示） */
  onDeleted: () => void
}

const input = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500/60'
const btn = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium py-2 transition-colors disabled:opacity-50'
const btnDanger = 'w-full rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-300 text-sm font-medium py-2 transition-colors disabled:opacity-50'

/**
 * 账号中心：修改密码 / 退出所有设备 / 数据导出 / 账号注销。
 * 甲方《账号体系交付清单》最后四项的用户入口。
 */
export default function AccountModal({ user, onClose, onToast, onDeleted }: AccountModalProps) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showDelete, setShowDelete] = useState(false)

  const changePassword = async () => {
    const pwErr = validatePassword(newPassword)
    if (pwErr) { setErr(pwErr); return }
    setBusy(true); setErr('')
    const r = await updatePassword(newPassword)
    setBusy(false)
    if (r.ok) { setNewPassword(''); onToast('✓', '密码已修改，所有旧会话已失效') }
    else setErr(r.message)
  }

  const logoutAll = async () => {
    setBusy(true)
    await signOut()
    setBusy(false)
    onDeleted() // 全设备登出后本设备会话同样失效
  }

  const doExport = async () => {
    setBusy(true); setErr('')
    try { await exportAccountData(); onToast('📥', '账号数据已导出（JSON），含全部云端历史') }
    catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  const doDelete = async () => {
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) { setErr('确认邮箱与账号不一致'); return }
    setBusy(true); setErr('')
    try {
      await deleteAccount(confirmEmail)
      onDeleted()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[420px] max-w-full max-h-[85vh] overflow-y-auto">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">👤 账号中心</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-all">{user.email}</p>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">修改密码</p>
            <div className="flex gap-2">
              <input className={input} type="password" placeholder="新密码（≥8 位，含字母和数字）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button className="shrink-0 px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50" disabled={busy || !newPassword} onClick={() => void changePassword()}>修改</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">修改后其他设备的登录会话将全部失效。</p>
          </div>

          <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">会话与数据</p>
            <button className={btn} disabled={busy} onClick={() => void logoutAll()}>退出所有设备</button>
            <button className={btn} disabled={busy} onClick={() => void doExport()}>📥 导出我的数据（JSON）</button>
          </div>

          <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
            {!showDelete ? (
              <button className={btnDanger} onClick={() => setShowDelete(true)}>注销账号（永久删除）</button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-red-500">将永久删除账号及全部云端历史，不可恢复。请输入账号邮箱 <b>{user.email}</b> 确认：</p>
                <input className={input} placeholder={user.email} value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
                <div className="flex gap-2">
                  <button className={btnDanger} disabled={busy || !confirmEmail} onClick={() => void doDelete()}>确认注销</button>
                  <button className={btn} onClick={() => { setShowDelete(false); setConfirmEmail('') }}>取消</button>
                </div>
              </div>
            )}
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">关闭</button>
        </div>
      </div>
    </div>
  )
}
