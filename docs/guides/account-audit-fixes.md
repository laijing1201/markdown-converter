# 账号审计修复部署与验证

本次修复覆盖注销请求体、管理员 2FA、首次强制改密、强制下线、注册用户限额、匿名并发额度和 Service Worker 缓存清理。

## 部署顺序

1. 在测试环境应用 `supabase/migrations/0005_account_audit_fixes.sql`，再部署 `admin-api`、`account-service`、`export-ticket`。三个函数必须一起升级；旧 export-ticket 不使用新配额事务。
2. 保持现有 Edge Function 网关配置。admin-api 使用自定义管理会话，export-ticket 支持匿名调用，不能让网关仅按 Supabase 用户 JWT 拦截这两个端点。account-service 在函数内部验证用户及会话。
3. 设置已有的 `TICKET_HMAC_SECRET`，发布 Web/桌面/Android/扩展的新构建。缺密钥时签发请求直接失败，不扣额度。
4. 用测试账号完成下方验收后，再按相同顺序发布正式环境。本次代码修复未执行线上迁移或部署。

迁移新增 `consume_export_quota` 和 `revoke_user_sessions`，只授予 service_role 执行权。前者保持设备与 IP 双重上限及现有注册用户 100 次规则；后者删除目标用户的刷新凭据与会话，并撤销其管理会话。`current_account_session_active` 按 JWT 的 session_id 检查会话，配合 RLS 和 Edge 校验拒绝尚未过期的旧 JWT。

会话设计参考 [Supabase 会话文档](https://supabase.com/docs/guides/auth/sessions)：JWT 到期前仍可能有效，需要检查 session_id 对应的数据库会话。迁移依赖 Supabase 管理的 auth.sessions 和 auth.refresh_tokens，部署前需在目标测试环境验证迁移角色的权限。

## 自动验证

- `npm test`：现有测试 + 接口回归 + PGlite 数据库迁移、额度边界、事务回滚、RPC 权限、撤销后 RLS 读写拒绝及重新登录恢复。
- `node scripts/test-admin-ui.mjs`：本地模拟 API 的真实浏览器测试，覆盖 2FA 和首次改密；默认查找 Windows Edge，也可设置 CHROME_PATH。
- `npm run typecheck`、`npm run build`：前端类型与生产构建。

PGlite 是单连接内存 PostgreSQL，不能替代真正多连接竞争测试，也不能证明线上 Supabase Auth 的集成行为。发布验收还需：

1. 同一设备并行发送 5 次导出请求，额度为 1 时仅一次成功；不同设备同 IP 不超过每日 IP 上限；同设备跨 IP 不超过设备上限。
2. 注册用户累计 99 次时并行导出，仅一次达到 100 次，其他返回 402。
3. 强制下线后，用旧 JWT 请求 histories、export-ticket、account-service，均不得继续访问；旧 refresh token 不能刷新，重新登录恢复。
4. 开启 TOTP 的管理员正常登录；初始密码用户只能改密或退出，直接请求管理 API 返回 403；改密后所有旧管理会话失效。
5. 以正确和错误邮箱尝试注销测试账号，确认只有正确邮箱成功；确认历史随账号级联删除。

回滚须同步回滚函数与前端。迁移增加的 RLS 会话校验与安全函数不要在仍有新 Edge Function 实例运行时移除。已撤销会话不可恢复，用户需重新登录。
