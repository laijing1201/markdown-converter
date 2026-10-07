# Supabase API 反向代理（国内 SNI 阻断应对）—— 已部署

## 问题结论（2026-10-07 诊断）

注册页「获取验证码」报 `HTTP 504` 的根因**不在服务端**：

- `*.supabase.co`（443）在大陆网络被按域名（TLS SNI）阻断：同一 Cloudflare IP，
  SNI 用 `api.supabase.com` 握手成功，用 `whycpppvmxclyuzzctgx.supabase.co` 立即被重置。
  `*.workers.dev` 同样在阻断名单内（实测直连被重置）。
- 服务端健康：海外多节点探测 `auth/v1/health` 均 100–400ms 返回 401（缺 apikey 的预期响应）；
  三个 Edge Functions 均为 ACTIVE v2；迁移 0001–0005 已应用。
- `auth.users` 空表证明注册请求从未到达服务器——504 来自本机代理链
  （Clash/aTrust 等网关连不上 supabase.co 时返回的网关超时）。

此为已知区域性阻断（Supabase 官方专文 "Navigating Regional Network Blocks"）。

## 已实施的方案：Netlify 同源反向代理

站点：**https://shift-ai-163.netlify.app**（Netlify 免费，走 AWS 边缘，国内可达）

- 前端构建时 `VITE_SUPABASE_URL=https://shift-ai-163.netlify.app`（指向站点自身），
  API 请求同源发出，由 Netlify 边缘转发到 `whycpppvmxclyuzzctgx.supabase.co`，
  不经过被阻断的 SNI。
- 代理规则在两处（保持一致）：[netlify.toml](../../netlify.toml) 与
  [public/_redirects](../../public/_redirects)（GitHub Pages 会忽略后者）。
- 已验证：站点 200、`/auth/v1/health` 经代理返回 GoTrue 标准响应、
  `POST /functions/v1/export-ticket` 返回真实额度数据、`/admin.html` 正常（不被 SPA 规则遮蔽）。

### 部署方式

本地构建 + zip 部署（netlify-cli 已登录本机）：

```bash
VITE_SUPABASE_URL=https://shift-ai-163.netlify.app npm run build
netlify deploy --prod --dir=dist
```

（`VITE_SUPABASE_ANON_KEY` 由本地 `.env` 提供，vite 自动读取。）

### 相关配置位置

- GitHub 仓库 Secret `VITE_SUPABASE_URL` 也已指向该代理域名——
  GitHub Pages（https://laijing1201.github.io/markdown-converter/）的 API 走同一条代理链（跨域，Supabase 网关允许 CORS）。
- 邮箱验证链接回跳域名需在 **Supabase Dashboard → Authentication → URL Configuration →
  Redirect URLs** 中加入 `https://shift-ai-163.netlify.app/**`
  （6 位验证码主流程不依赖此项；邮件里的验证链接回跳依赖）。

### 本机开发注意事项

本机局域网 DNS（172.16.245.2）不解析 `netlify.app` 域名（NXDOMAIN）。
浏览器若无法打开站点，用管理员终端执行：

```powershell
Add-Content C:\Windows\System32\drivers\etc\hosts "`n52.74.6.109 shift-ai-163.netlify.app`n13.215.239.219 shift-ai-163.netlify.app"
ipconfig /flushdns
```

命令行测试可绕过 DNS：`curl --resolve shift-ai-163.netlify.app:443:52.74.6.109 https://shift-ai-163.netlify.app/auth/v1/health`

## 弃用与清理

- Cloudflare Worker `shift-ai-api.488442310.workers.dev`（绑定了默认 workers.dev 域名）：
  workers.dev 被国内阻断，已弃用；可登录 Cloudflare 删除，不影响现有链路。
- 若未来购买自有域名：可将域名绑到该 Netlify 站点（Site configuration → Change site name
  / Custom domains），或改用 Supabase 官方 Custom Domain（Pro 计划），替换各处
  `shift-ai-163.netlify.app` 即可。

## 验证清单

- [x] `curl https://shift-ai-163.netlify.app/auth/v1/health` → 401（经代理）
- [x] 匿名导出额度查询经代理返回真实数据
- [x] `/admin.html` 正常
- [ ] 注册页「获取验证码」收到 6 位验证码邮件（待真实浏览器验证）
- [ ] 验证码校验进入登录态；登出重新登录
- [ ] 管理后台登录 + 强制改密 + TOTP 流程
- [ ] Supabase Redirect URLs 加入站点域名
