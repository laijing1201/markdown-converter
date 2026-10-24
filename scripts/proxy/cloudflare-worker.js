/**
 * Shift AI — Supabase API 反向代理（Cloudflare Worker）
 *
 * 背景：国内网络对 *.supabase.co（443）存在 SNI 阻断（TLS 握手被重置），
 * Supabase 服务端本身健康。前端改为访问本代理域名即可绕过阻断。
 *
 * 部署（二选一）：
 * A. Dashboard：Workers & Pages → Create Worker → 粘贴本文件 → Deploy →
 *    Settings → Domains & Routes 绑定自有域名（国内可达的关键：不能用默认 *.workers.dev）。
 * B. wrangler：npx wrangler deploy，环境变量 UPSTREAM 可在 wrangler.toml 配置。
 *
 * 部署后：把 GitHub 仓库 Secret VITE_SUPABASE_URL 从
 *   https://whycpppvmxclyuzzctgx.supabase.co 改为 https://<你的代理域名>，
 *   重新触发 Deploy GitHub Pages；本地 .env 同步修改（影响 Electron/扩展构建）。
 *
 * 验证：curl https://<代理域名>/auth/v1/health  →  401（缺 apikey 的预期响应）
 */

const UPSTREAM = 'https://whycpppvmxclyuzzctgx.supabase.co';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function corsHeaders() {
  // supabase-js 用 Bearer/apikey 头而非 Cookie，无需回显 Origin，通配即可
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,apikey,x-client-info,accept,x-supabase-api-version',
    'access-control-max-age': '86400',
  };
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const headers = new Headers(request.headers);
    for (const h of HOP_BY_HOP) headers.delete(h);
    headers.set('x-forwarded-host', incoming.host);
    headers.set('x-forwarded-proto', 'https');

    const res = await fetch(UPSTREAM + incoming.pathname + incoming.search, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });

    const resHeaders = new Headers(res.headers);
    for (const h of HOP_BY_HOP) resHeaders.delete(h);
    for (const [k, v] of Object.entries(corsHeaders())) {
      if (!resHeaders.has(k)) resHeaders.set(k, v);
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: resHeaders });
  },
};
