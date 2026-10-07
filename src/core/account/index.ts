/**
 * 账号体系统一出口。
 * website（App.tsx）与 extension（exporter-main.ts）都从这里接入，
 * 保证两端计次 / 认证 / 云端历史行为一致。
 */
export { accountEnabled, cloudHistoryEnabled, SUPABASE_URL, SUPABASE_ANON_KEY } from './config'
export { getSupabase } from './client'
export {
  getAuthUser,
  onAuthChange,
  signIn,
  signUp,
  verifySignupCode,
  signOut,
  sendPasswordReset,
  resendVerification,
  updatePassword,
  validateEmail,
  validatePassword,
  type AccountUser,
  type AuthResult,
} from './auth'
export {
  requestExportTicket,
  refreshRemaining,
  cachedRemaining,
  type ExportFormat,
  type TicketResult,
  type Remaining,
} from './quota'
export { saveCloudHistory, exportMyHistoryJson } from './cloudHistory'
export { exportAccountData, deleteAccount } from './selfService'
export { getDeviceId } from './fingerprint'
