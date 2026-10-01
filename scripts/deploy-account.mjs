/**
 * 账号体系 + 管理员后台 一键部署脚本（甲方交付项的落地工具）。
 *
 * 前置条件（三项凭据，缺一即退出并提示）：
 *   SUPABASE_ACCESS_TOKEN   —— Supabase Account → Access Tokens 生成的令牌
 *   VITE_SUPABASE_URL       —— 项目地址（https://<ref>.supabase.co）
 *   VITE_SUPABASE_ANON_KEY  —— 项目 anon key（公开键，配 RLS 使用）
 * 可放在 .env.local（本脚本自动读取，不进 git）或进程环境变量。
 *
 * 执行内容：
 *   1. supabase link   —— 关联项目
 *   2. supabase db push —— 应用 0001/0002 迁移（建表 + RLS + 权限矩阵种子）
 *   3. 部署 5 个 Edge Functions（export-ticket / cleanup / import-link / admin-api / account-service）
 *   4. 配置服务端 secrets（TICKET_HMAC_SECRET / IP_HASH_PEPPER，未提供则自动生成并打印）
 *   5. 线上验证（export-ticket checkOnly / admin-api 存活探测）
 *   6. 打印剩余手工步骤（超管创建、GitHub 仓库 Secrets、测试账号）
 *
 * 运行：node scripts/deploy-account.mjs [--dry-run]
 */
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { join, resolve } from 'path'

const ROOT = resolve('.')
const dry = process.argv.includes('--dry-run')

// ── 读取凭据（.env.local 优先，其次进程环境）────────────────────────────────
function loadEnvFile(file) {
  const path = join(ROOT, file)
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/)
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env'), ...process.env }
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN
const URL = (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const PROJECT_REF = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i) ?? [])[1]

console.log('═══ MarkDoc 账号体系部署 ═══')
for (const [k, v] of [['SUPABASE_ACCESS_TOKEN', ACCESS_TOKEN], ['VITE_SUPABASE_URL', URL], ['VITE_SUPABASE_ANON_KEY', ANON_KEY]]) {
  if (!v) {
    console.error(`✗ 缺少 ${k}。获取方式见 docs/guides/账号体系部署.md §1；可写入 .env.local（不进 git）。`)
    process.exit(1)
  }
  console.log(`✓ ${k} = ${k === 'SUPABASE_ACCESS_TOKEN' || k === 'VITE_SUPABASE_ANON_KEY' ? v.slice(0, 8) + '…' : v}`)
}
if (!PROJECT_REF) {
  console.error('✗ VITE_SUPABASE_URL 不是合法的 Supabase 项目地址')
  process.exit(1)
}

function run(cmd) {
  console.log(`\n$ ${cmd}`)
  if (dry) return ''
  return execSync(cmd, {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, SUPABASE_ACCESS_TOKEN },
    encoding: 'utf8',
    cwd: ROOT,
  })
}

const randomSecret = () => createHash('sha256').update(crypto.randomUUID() + Date.now()).digest('hex')
const TICKET_HMAC_SECRET = env.TICKET_HMAC_SECRET ?? randomSecret()
const IP_HASH_PEPPER = env.IP_HASH_PEPPER ?? randomSecret()

// 1-4 部署主体
run(`npx -y supabase@latest link --project-ref ${PROJECT_REF}`)
run('npx -y supabase@latest db push')
for (const fn of ['export-ticket', 'cleanup', 'import-link', 'admin-api', 'account-service']) {
  run(`npx -y supabase@latest functions deploy ${fn}`)
}
run(`npx -y supabase@latest secrets set TICKET_HMAC_SECRET=${TICKET_HMAC_SECRET} IP_HASH_PEPPER=${IP_HASH_PEPPER}`)

// 5 线上验证
if (!dry) {
  console.log('\n═══ 线上验证 ═══')
  const check = async (name, url, init) => {
    try {
      const res = await fetch(url, init)
      const body = await res.text()
      console.log(`${res.ok || res.status === 401 ? '✓' : '✗'} ${name}: HTTP ${res.status} ${body.slice(0, 80)}`)
      return res
    } catch (e) {
      console.log(`✗ ${name}: ${e.message}`)
    }
  }
  await check('export-ticket（checkOnly）', `${URL}/functions/v1/export-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ deviceId: 'deploy-check', fingerprint: 'deploy-check', format: 'docx', source: 'web', checkOnly: true }),
  })
  await check('admin-api（无凭据应 401）', `${URL}/functions/v1/admin-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ action: 'me' }),
  })
}

// 6 剩余手工步骤
console.log(`
═══ 剩余手工步骤（约 10 分钟）═══
1. GitHub 仓库 Settings → Secrets and variables → Actions，新增两个值：
     VITE_SUPABASE_URL = ${URL}
     VITE_SUPABASE_ANON_KEY = ${ANON_KEY}
   然后触发 Actions「Deploy GitHub Pages」→ Run workflow（或任意 push）。
   构建完成后：首页右上角出现「登录」徽标，匿名免费次数开始执法。

2. 创建初始超级管理员（Supabase Dashboard）：
   a. Authentication → Users → Add user（填管理员邮箱、强密码、勾选 Confirm email）
   b. SQL Editor 执行：
      insert into public.admin_users (id, role_key, must_change_password)
      select id, 'super', true from auth.users where email = '<管理员邮箱>';

3. 创建普通管理员测试账号：访问 https://<你的域名>/admin.html 登录超管，
   在「🔑 管理员」页创建 admin 角色测试账号。

4. （可选）Resend.com 注册并配置发件域名后：
   npx supabase secrets set RESEND_API_KEY=<key> MAIL_FROM="MarkDoc <noreply@你的域名>"
   未配置时管理端发信会如实记为失败（email_logs 可见）。

${dry ? '（dry-run：以上为将要执行的动作）' : '✓ 部署完成。 secrets 已写入，请妥善保存：\n  TICKET_HMAC_SECRET=' + TICKET_HMAC_SECRET + '\n  IP_HASH_PEPPER=' + IP_HASH_PEPPER}
`)
