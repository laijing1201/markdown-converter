import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import assert from 'node:assert/strict'

function query(result) {
  return new Proxy({}, { get: (_, key) => key === 'then'
    ? (ok, fail) => Promise.resolve(result).then(ok, fail) : () => query(result) })
}
function edge(file, client, env = {}) {
  let handler
  function load(path) {
    const module = { exports: {} }
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports,
      require: name => name.startsWith('jsr:') ? { createClient: () => client } : load(resolve(dirname(path), name)),
      Deno: { env: { get: key => env[key] ?? 'test-value' }, serve: fn => { handler = fn } },
      Response, Request, crypto, btoa, TextEncoder, console,
    })
    return module.exports
  }
  load(resolve(file))
  return handler
}
const user = { id: 'user-id', email: 'user@example.test' }
const request = (body, auth = true) => new Request('https://test.local', {
  method: 'POST', headers: auth ? { Authorization: 'Bearer test' } : {}, body: JSON.stringify(body),
})
let deleted = 0
let active = true
let rpcError = null
let mustChange = true
let passwordUpdates = 0
const rpcCalls = []
const client = {
  auth: {
    getUser: async () => ({ data: { user } }),
    admin: {
      deleteUser: async () => { deleted++; return {} },
      updateUserById: async () => { passwordUpdates++; return {} },
    },
  },
  rpc: async (name, params) => {
    rpcCalls.push({ name, params })
    if (name === 'current_account_session_active') return { data: active }
    if (name === 'consume_export_quota') return { data: { error: 'QUOTA_EXCEEDED' }, error: rpcError }
    return { error: rpcError }
  },
  from: name => query({ data: name === 'admin_sessions'
    ? { id: 'session', admin_id: user.id, expires_at: new Date(Date.now() + 60000).toISOString() }
    : name === 'admin_users' ? { id: user.id, role_key: 'super', is_active: true, must_change_password: mustChange }
    : name === 'admin_role_permissions' ? [{ permission_key: 'user.force_logout' }] : null, error: null }),
}
const account = edge('supabase/functions/account-service/index.ts', client)
assert.equal((await account(request({ action: 'delete', confirm: ' USER@example.test ' }))).status, 200)
assert.equal(deleted, 1)
assert.equal((await account(request({ action: 'delete', confirm: 'wrong' }))).status, 400)
assert.equal(deleted, 1)
active = false
assert.equal((await account(request({ action: 'delete', confirm: user.email }))).status, 401)
active = true
console.log('✓ 正确邮箱注销、错误邮箱拒绝、已撤销会话拒绝')

const ticket = edge('supabase/functions/export-ticket/index.ts', client)
assert.equal((await ticket(request({ format: 'pdf' }))).status, 402)
rpcError = { message: 'database unavailable' }
assert.equal((await ticket(request({ deviceId: 'device' }, false))).status, 500)
rpcError = null
const unconfigured = edge('supabase/functions/export-ticket/index.ts', client, { TICKET_HMAC_SECRET: '' })
const before = rpcCalls.length
assert.equal((await unconfigured(request({ deviceId: 'device' }, false))).status, 500)
assert.equal(rpcCalls.length, before)
active = false
assert.equal((await ticket(request({ deviceId: 'device' }))).status, 401)
active = true
console.log('✓ 超限不签发、数据库失败关闭、缺密钥不扣减、失效 JWT 不降为匿名')

const admin = edge('supabase/functions/admin-api/index.ts', client)
assert.equal((await admin(request({ action: 'user.forceLogout', params: { id: user.id } }))).status, 403)
assert.equal((await admin(request({ action: 'password.change', params: { password: 'short' } }))).status, 400)
assert.equal(passwordUpdates, 0)
assert.equal((await admin(request({ action: 'password.change', params: { password: 'NewPassword12345' } }))).status, 200)
assert.equal(passwordUpdates, 1)
assert.equal(rpcCalls.at(-1).name, 'revoke_user_sessions')
mustChange = false
rpcError = { message: 'database unavailable' }
assert.equal((await admin(request({ action: 'user.forceLogout', params: { id: user.id } }))).status, 500)
rpcError = null
assert.equal((await admin(request({ action: 'user.forceLogout', params: { id: user.id } }))).status, 200)
assert.equal(rpcCalls.at(-1).params.p_user_id, user.id)
console.log('✓ 强制改密拦截、密码校验、成功改密撤销会话、下线失败不报成功')

const ui = readFileSync('src/admin/AdminApp.tsx', 'utf8')
const apiCode = ui.slice(ui.indexOf('class AdminApiError'), ui.indexOf('const card ='))
const context = { API: 'https://test.local', TOKEN_KEY: 'token', ME_KEY: 'me',
  sessionStorage: { getItem: () => null, removeItem: () => {} },
  fetch: async () => new Response(JSON.stringify({ error: '需要两步验证', needTotp: true }), { status: 401 }),
}
vm.createContext(context)
vm.runInContext(ts.transpileModule(apiCode, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
await assert.rejects(context.api('login', {}), e => e.needTotp === true)
console.log('✓ 401 双因素挑战保留结构化标记')

const listeners = {}, removed = []
vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), {
  self: { addEventListener: (name, fn) => { listeners[name] = fn }, clients: { claim: async () => {} } },
  caches: { keys: async () => ['markdoc-v1.2.0', 'markdoc-v1.2.0-2', 'markdoc-fonts-v1', 'other-app'],
    delete: async name => { removed.push(name); return true } },
})
await new Promise((ok, fail) => listeners.activate({ waitUntil: p => p.then(ok, fail) }))
assert.deepEqual(removed, ['markdoc-v1.2.0'])
console.log('✓ SW 只删除旧应用壳、保留字体及其他应用缓存')
