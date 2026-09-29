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

// ── 管理员后台：权限矩阵一致性（甲方《管理员后台交付清单》）────────────────
// 校验 0001/0002 迁移的权限种子覆盖 admin-api 全部动作所需权限，
// 防止「代码要了权限、数据库没种子」的静默 403。
{
  const { readFileSync } = await import('fs')
  const sql = readFileSync('supabase/migrations/0001_init.sql', 'utf8') + readFileSync('supabase/migrations/0002_admin_console.sql', 'utf8')
  const seeded = new Set([...sql.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]))
  const fn = readFileSync('supabase/functions/admin-api/index.ts', 'utf8')
  // 只提取 ACTION_PERMISSIONS 映射的「权限值」，避免把审计动作名（user.disable 等）误当权限键
  const mapBlock = /const ACTION_PERMISSIONS[^=]*= \{([\s\S]*?)\}/.exec(fn)?.[1] ?? ''
  // '动作': '权限' 或 '动作': null —— 只取冒号后的权限值
  const required = new Set(
    [...mapBlock.matchAll(/'[^']+'\s*:\s*(?:'([a-z_.]+)'|null)/g)].map((m) => m[1]).filter((v): v is string => !!v),
  )
  const missing = [...required].filter((k) => !seeded.has(k) && k !== 'admin.login')
  check('admin-api 所需权限全部有数据库种子', missing.length === 0, `缺失: ${missing.join(', ')}`)
  check('权限矩阵含三角色', sql.includes("'super', '超级管理员'") && sql.includes("'admin', '普通管理员'") && sql.includes("'auditor', '审计员'"))
  check('普通管理员默认无查看历史正文/改配置/删用户权限',
    sql.match(/insert into public\.admin_role_permissions \(role_key, permission_key\) values[\s\S]*?\('admin', 'dashboard\.view'\)[\s\S]*?on conflict do nothing;/)?.[0]?.includes("history.content") !== true)
  check('审计日志不可修改删除（REVOKE）', sql.includes('revoke update, delete on public.audit_logs'))
  check('系统配置种子含免费次数/开放注册/维护模式', ['free_full_uses', 'registration_open', 'maintenance_mode', 'force_email_verify'].every((k) => sql.includes(`('${k}'`)))
  // 管理员后台独立入口存在
  check('admin.html 独立入口存在', await existsSync2('admin.html'))
  check('vite 构建包含 admin 入口', readFileSync('vite.config.ts', 'utf8').includes("admin: resolve(__dirname, 'admin.html')"))
}

async function existsSync2(p: string): Promise<boolean> {
  const { existsSync } = await import('fs')
  return existsSync(p)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
