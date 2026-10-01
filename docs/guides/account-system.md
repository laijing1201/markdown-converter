# MarkDoc 账号体系与云端历史 —— 部署与运维文档

> 架构：前端（GitHub Pages 静态站 + 浏览器扩展）保持不变，后端 = Supabase
> （Auth + Postgres + Edge Functions）。**所有面向用户的数据隔离由数据库 RLS
> 保证**；匿名计次与管理员敏感操作只通过 Edge Functions（service_role 仅存于
> 服务端）。配置开关：`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 未配置时，
> 网站、插件行为与无账号版本完全一致。

## 1. 开通资源（一次性，约 30 分钟）

1. **创建 Supabase 项目**：<https://supabase.com/dashboard> → New project（区域选 Singapore 离国内最近）。
2. **执行建表脚本**：Dashboard → SQL Editor → 粘贴 `supabase/migrations/0001_init.sql` 全量执行（幂等，可重复跑）。
3. **记下凭证**：Settings → API 的 `Project URL` 与 `anon public key`（anon key 是公开凭证，可进前端）。
4. **配置邮件**：Authentication → SMTP Settings → 开启 Custom SMTP（推荐 Resend 或国内 SMTP 中转，QQ/163 送达率更好）；Authentication → Emails 调整验证邮件模板（链接有效期 10 分钟在 Auth 配置里）。
5. **关闭自动确认**（正式环境必须）：Authentication → Providers → Email → "Confirm email" 开启 —— 保证"未验证邮箱不能使用"（验收 3）。
6. **设置服务端密钥**（本地装 CLI 后）：
   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase secrets set TICKET_HMAC_SECRET=$(openssl rand -hex 32) \
                         IP_HASH_PEPPER=$(openssl rand -hex 16) \
                         CLEANUP_SECRET=$(openssl rand -hex 16)
   supabase functions deploy export-ticket
   supabase functions deploy cleanup
   ```
7. **定时清理**：Dashboard → Edge Functions → cleanup → Schedules → 每日一次（或用 pg_cron 调用，见 cleanup/index.ts 头注释）。
8. **初始超级管理员**（不开放注册，用邮箱先在前台注册一次，然后 SQL 升级）：
   ```sql
   insert into public.admin_users (id, role_key, must_change_password)
   select id, 'super', true from auth.users where email = '<管理员邮箱>';
   ```
   该账号首次登录后台强制改密（验收 22）。2FA：Authentication → MFA 开启 TOTP。
9. **前端环境变量**：
   - 本地：复制 `.env.example` 为 `.env`，填入 URL/anon key；
   - 线上：GitHub 仓库 Settings → Secrets and variables → Actions 添加
     `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（deploy.yml 构建时注入；
     需在 workflow 的 build 步骤加 `env:` 引用，见第 4 节）。
   - 插件：仓库根目录同一份 `.env`（`vite.extension.config.ts` 已设 envDir 指向根目录）。

## 2. 环境变量总表

见 `.env.example`。原则：`VITE_` 前缀 = 公开可进前端；TICKET_HMAC_SECRET /
IP_HASH_PEPPER / CLEANUP_SECRET / SERVICE_ROLE 只存 Supabase secrets，绝不进前端。

## 3. 系统配置项（管理后台或直接改 system_configs 表）

| key | 默认 | 说明 |
|---|---|---|
| free_full_uses | 1 | 匿名设备终身免费完整使用次数 |
| ip_daily_extra | 3 | 同 IP 每日匿名额外放行次数 |
| history_retention_days | 365 | 云端历史保留天数（cleanup 按此清理） |
| registered_unlimited | true | 注册用户是否不限次 |
| registration_open | true | 是否开放注册（预留） |
| force_email_verify | true | 未验证邮箱限制使用 |
| maintenance_mode | false | 维护模式（票据端点返回 503 + 公告） |
| announcement | null | 全站公告文本（预留） |

## 4. GitHub Pages 构建注入（上线账号体系时）

`.github/workflows/deploy.yml` 的 build 步骤增加：

```yaml
      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
```

（Secrets 未配置时这两个变量为空 → 账号体系自动关闭，部署无风险。）

## 5. 前端 / 插件已接入的位置

- 网站：`src/App.tsx` `runExportGated()` —— 所有导出入口（Word/PDF/预览后导出/预检确认/深度修复后导出）统一经过；配额用尽弹 `AuthModal`，登录后自动续接导出。
- 插件：`extension/exporter-main.ts` `runExport()` 同一票据端点（source=extension）；配额用尽显示内联登录表单 + 「去网站注册」深链（`?auth=register` 直开注册弹窗）。
- 云端历史：登录用户导出成功后异步写入 `histories`（RLS 限本人），失败静默不影响导出。

## 6. 数据库备份

- Supabase Pro（$25/月）：每日自动备份 + 7 天 PITR —— 满足需求"每日备份至少保留 7 天"。
- 免费档无自动备份：可自建 GitHub Action 每日 `pg_dump`（需DATABASE 凭证，注意加密存储）。

## 7. 待上线项（后续里程碑）

- M2：云端历史页（列表/搜索/分页/重命名/删除/再次导出/导出 JSON）、匿名本地记录迁移按钮。
- M3：管理后台 `/admin`（表结构、角色权限矩阵、audit_logs 已就绪；需 Edge Functions + 后台 UI）。
- M4：隐私政策/服务条款法务定稿（`public/privacy.html`、`public/terms.html` 为草案模板）、IP 白名单（可选）。

## 8. 验收对照（需求书 25 条）

1~2 匿名试用与拦截 → 票据端点 + AuthModal；3 邮箱验证 → Supabase Confirm email；
4~6 云端历史 → histories + RLS；7~8 API 401/403 → RLS（无策略表 + 本人策略）；
9 删除/清空 → histories API；10 密码重置 → Auth reset；11 注销 → delete user 级联 + cleanup；
12 移动端 → 响应式 UI；13 功能不退化 → 转换核心零改动；
14~25 管理员模块 → 第 7 节 M3 交付（schema 已就绪）。
