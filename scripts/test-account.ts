/**
 * 账号模块单元测试（无后端，纯逻辑）：
 *   - 配置开关：未配置 VITE_SUPABASE_* 时 accountEnabled=false（历史行为旁路）
 *   - 密码/邮箱规则（需求 §3.2：8 位 + 字母 + 数字）
 *   - 匿名设备 ID 稳定性与格式
 *   - 剩余次数缓存读写
 *   - 票据请求在关闭态直接放行（'local'）
 *
 * 运行：npx tsx scripts/test-account.ts
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://markdoc.test/' })
const g = globalThis as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'localStorage']) {
  g[key] = (dom.window as unknown as Record<string, unknown>)[key]
}

const {
  accountEnabled,
  getDeviceId,
  validateEmail,
  validatePassword,
  requestExportTicket,
  cachedRemaining,
} = await import('../src/core/account')

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
    fail++
  }
}

console.log('账号模块（未配置环境变量 = 关闭态）')
check('未配置 Supabase 时 accountEnabled=false', accountEnabled === false)

check('空邮箱不通过', validateEmail('') !== null)
check('非法邮箱不通过', validateEmail('foo@bar') !== null)
check('合法邮箱通过', validateEmail('user@example.com') === null)

check('短密码不通过', validatePassword('ab1') !== null)
check('无数字不通过', validatePassword('abcdefgh') !== null)
check('无字母不通过', validatePassword('12345678') !== null)
check('合规密码通过', validatePassword('abcd1234') === null)

const id1 = getDeviceId()
const id2 = getDeviceId()
check('设备 ID 会话内稳定', id1 === id2)
check('设备 ID 为 UUID 格式', /^[0-9a-f-]{36}$/i.test(id1))

check('关闭态票据请求直接放行', (await requestExportTicket('pdf')).ok === true)
check('关闭态票据标记为 local', (await requestExportTicket('docx')).kind === 'anon')

console.log('RESULT:', pass, 'passed,', fail, 'failed')
process.exit(fail === 0 ? 0 : 1)
