import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const storage = new Map()
let calls = 0
let response = { ok: true, remaining: { deviceLeft: 4, ipLeft: 3 } }
let status = 200
let offline = false
const exports = {}
vm.runInNewContext(transpile(readFileSync('src/core/account/quota.ts', 'utf8')), {
  exports,
  require: name => {
    if (name === './config') return { accountEnabled: true, SUPABASE_URL: 'https://test.local', SUPABASE_ANON_KEY: 'test' }
    if (name === './client') return { getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }
    if (name === './fingerprint') return { getDeviceId: () => 'device', getFingerprint: () => 'fingerprint' }
    throw new Error(`Unexpected import: ${name}`)
  },
  localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  fetch: async () => {
    calls++
    if (offline) throw new Error('offline')
    return new Response(JSON.stringify(response), { status })
  },
})
const exhausted = () => storage.set('markdoc.anon.uses.v1', JSON.stringify({ deviceId: 'device', used: 1, total: 1 }))
exhausted()
assert.equal((await exports.refreshRemaining()).deviceLeft, 4)
assert.equal(calls, 1)
assert.equal(JSON.parse(storage.get('markdoc.anon.uses.v1')).used, 1, '查询不能扣次数')
assert.equal(JSON.parse(storage.get('markdoc.anon.uses.v1')).total, 5)
exhausted()
assert.equal((await exports.requestExportTicket('pdf')).ok, true, '本地耗尽后也应向服务端申请')
assert.equal(calls, 2)
assert.equal(exports.cachedRemaining().deviceLeft, 4)
response = { ok: true, remaining: { deviceLeft: 0, ipLeft: 2 } }
assert.equal((await exports.refreshRemaining()).deviceLeft, 0, '管理员减少额度也要同步')
offline = true
assert.equal((await exports.requestExportTicket('pdf')).ok, false, '离线不能放行')
offline = false
status = 402
response = { error: 'QUOTA_EXCEEDED', remaining: { deviceLeft: 0, ipLeft: 0 } }
assert.equal((await exports.requestExportTicket('docx')).reason, 'QUOTA_EXCEEDED')
console.log('✓ 匿名额度增加恢复查询与导出、减少同步、查询不扣次、离线及服务端超限拒绝')

// 执行 App 中的真实回调，延迟票据与文件生成，模拟同一事件周期的连续点击。
const app = ts.createSourceFile('App.tsx', readFileSync('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'runExportGated') callback = node.initializer.arguments[0].getText(app)
  ts.forEachChild(node, visit)
}
visit(app)
assert.ok(callback)
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
let ticket = deferred()
let file = deferred()
let ticketCalls = 0
let fileCalls = 0
let busy = false
const context = {
  accountEnabled: true, exportInFlightRef: { current: false },
  setBusy: value => { busy = value },
  requestExportTicket: () => { ticketCalls++; return ticket.promise },
  doExportDocx: () => { fileCalls++; return file.promise },
  doExportPdf: () => { fileCalls++; return file.promise },
  setQuotaRemaining() {}, setAuthModal() {}, showToast() {},
}
vm.createContext(context)
vm.runInContext(transpile(`globalThis.run = ${callback}`), context)
const first = context.run('pdf')
assert.equal(busy, true, '申请票据之前显示忙碌')
await context.run('docx')
assert.equal(ticketCalls, 1, '票据等待期间只申请一次')
ticket.resolve({ ok: true, kind: 'anon', remaining: null })
await new Promise(resolve => setImmediate(resolve))
assert.equal(fileCalls, 1)
await context.run('pdf')
assert.equal(ticketCalls, 1, '生成文件期间也不能再次扣费')
file.resolve()
await first
assert.equal(busy, false)
assert.equal(context.exportInFlightRef.current, false)
ticket = deferred()
const retry = context.run('docx')
assert.equal(ticketCalls, 2, '完成后允许再次导出')
ticket.resolve({ ok: false, reason: 'QUOTA_EXCEEDED' })
await retry
assert.equal(busy, false)
assert.equal(context.exportInFlightRef.current, false, '拒绝后释放锁')
context.requestExportTicket = async () => { throw new Error('ticket failed') }
await assert.rejects(context.run('pdf'), /ticket failed/)
assert.equal(busy, false)
assert.equal(context.exportInFlightRef.current, false, '异常后释放锁')
context.requestExportTicket = async () => ({ ok: true, kind: 'anon', remaining: null })
const exportPdf = context.doExportPdf
context.doExportPdf = async () => { throw new Error('file failed') }
await assert.rejects(context.run('pdf'), /file failed/)
assert.equal(busy, false)
assert.equal(context.exportInFlightRef.current, false, '文件生成失败后释放锁')
context.doExportPdf = exportPdf
context.accountEnabled = false
file = deferred()
const local = context.run('docx')
await context.run('pdf')
assert.equal(fileCalls, 2, '关闭账号体系时仍阻止重复导出')
file.resolve()
await local
assert.equal(busy, false)
console.log('✓ 连续点击仅一次申请、生成期间保持锁、完成及失败释放锁、关闭账号体系仍防重复')
