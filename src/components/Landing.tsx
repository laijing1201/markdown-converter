/**
 * 落地页：首次进入显示，「立即体验」进入编辑器；向下滑动为本产品功能介绍。
 * 视觉：深色高级风（slate-950 底 + indigo→violet→fuchsia 渐变主色），
 * 玻璃拟态卡片 + 滚动渐显。功能文案与 index.html 预渲染正文保持一致
 * （改动产品功能时请同步两处 + /llms.txt）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { accountEnabled } from '../core/account'

interface LandingProps {
  /** 点击「立即体验」进入编辑器 */
  onEnter: () => void
  /** 打开登录 / 注册弹窗（accountEnabled=false 时入口不渲染） */
  onAuth: (mode: 'login' | 'register') => void
  /** true 时整页淡出（进入编辑器的过渡） */
  leaving?: boolean
}

/* ── 滚动渐显：进入视口后淡入上移 ─────────────────────────────────────── */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true)
            io.disconnect()
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out will-change-transform ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-7'
      } ${className}`}
    >
      {children}
    </div>
  )
}

/* ── 统一线性图标（stroke 1.5，24×24）────────────────────────────────── */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function IconFormula() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
      <path d="M17 4h-9l6.5 8L8 20h9" />
      <path d="M18.5 14.5l3 3m0-3l-3 3" />
    </svg>
  )
}
function IconPdf() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
      <path d="M7 3h7l4.5 4.5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h4.5" />
      <path d="M9.5 13h5m-5 3.5h5" />
    </svg>
  )
}
function IconTable() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17M12 4.5v15" />
    </svg>
  )
}
function IconMermaid() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
      <rect x="9" y="3" width="6" height="4.5" rx="1" />
      <rect x="3" y="16.5" width="6" height="4.5" rx="1" />
      <rect x="15" y="16.5" width="6" height="4.5" rx="1" />
      <path d="M12 7.5v4m0 0H6v5m6-5h6v5" />
    </svg>
  )
}
function IconLink() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
      <path d="M10.5 13.5a4 4 0 0 0 5.66 0l2.84-2.84a4 4 0 1 0-5.66-5.66l-1.4 1.4" />
      <path d="M13.5 10.5a4 4 0 0 0-5.66 0L5 13.34a4 4 0 1 0 5.66 5.66l1.4-1.4" />
    </svg>
  )
}
function IconBatch() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
      <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
      <path d="M3 12.5l9 4.5 9-4.5" />
      <path d="M3 17l9 4.5 9-4.5" opacity=".45" />
    </svg>
  )
}
function IconTemplate() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9h17M9.5 9v10.5" />
    </svg>
  )
}
function IconReport() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...stroke}>
      <path d="M12 3l7.5 2.7v5.6c0 4.4-3 8.1-7.5 9.7-4.5-1.6-7.5-5.3-7.5-9.7V5.7L12 3z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  )
}

/* ── 内容数据（与 index.html 预渲染正文一致）──────────────────────────── */
const FEATURES: { icon: ReactNode; title: string; desc: string }[] = [
  {
    icon: <IconFormula />,
    title: '公式原生可编辑',
    desc: '行内与行间 LaTeX 转为 Word 原生 OMML 公式，双击即可编辑；分式、根号、积分、求和、矩阵、希腊字母全支持。',
  },
  {
    icon: <IconPdf />,
    title: '真文本 PDF',
    desc: '字体子集嵌入的矢量 PDF，文字可选中、可搜索、可复制；带分页引擎、页眉页脚与目录。',
  },
  {
    icon: <IconTable />,
    title: '表格转原生 Word 表格',
    desc: '可编辑列宽、合并单元格、跨页表头自动重复；导出不残留任何 HTML 标签。',
  },
  {
    icon: <IconMermaid />,
    title: 'Mermaid 图表自动渲染',
    desc: '流程图、时序图、类图、状态图、甘特图、饼图自动渲染为高清图片嵌入文档。',
  },
  {
    icon: <IconLink />,
    title: 'AI 对话链接导入',
    desc: '粘贴 DeepSeek、ChatGPT、Kimi 等平台的公开分享链接，自动抓取对话转为 Markdown，支持多链接合并。',
  },
  {
    icon: <IconBatch />,
    title: '批量转换',
    desc: '一次上传多个 .md 文件，统一套用排版模板转 Word，打包 ZIP 一次性下载。',
  },
  {
    icon: <IconTemplate />,
    title: '实时预览与三套模板',
    desc: '左侧输入、右侧所见即所得；内置学术论文、商务报告、通用办公三套排版模板，可另存自定义模板。',
  },
  {
    icon: <IconReport />,
    title: '导出质量自检报告',
    desc: '导出后逐条列出公式转换结果（含源码行号）、表格、图表与警告，问题一目了然。',
  },
]

const STEPS: { no: string; title: string; desc: string }[] = [
  { no: '01', title: '粘贴 AI 回答', desc: '把 ChatGPT / DeepSeek / Kimi 的回答粘贴到左侧编辑器，也支持拖入 .md 文件、粘贴 AI 分享链接。' },
  { no: '02', title: '预览并选模板', desc: '右侧实时预览排版效果，切换学术论文 / 商务报告 / 通用办公模板，调整字体、页眉页脚。' },
  { no: '03', title: '一键导出', desc: '导出 Word 或 PDF：公式原生可编辑、表格为原生表格、图表高清嵌入，并给出质量自检报告。' },
]

const PLATFORMS: { icon: string; name: string; desc: string; tag?: string }[] = [
  { icon: '🌐', name: '在线版', desc: '浏览器直接使用，无需安装', tag: '当前' },
  { icon: '📱', name: '安卓端', desc: '「添加到主屏幕」即得全屏 App，或安装 APK' },
  { icon: '🖥️', name: '桌面版', desc: 'Electron 应用，支持本地文件打开 / 保存' },
  { icon: '🧩', name: '浏览器扩展', desc: '在 ChatGPT / DeepSeek 页面内直接导出 Word / PDF' },
]

const GITHUB_URL = 'https://github.com/laijing1201/markdown-converter'

/* ── 小组件 ──────────────────────────────────────────────────────────── */

/** 渐变主 CTA */
function CtaButton({ onEnter, size = 'lg' }: { onEnter: () => void; size?: 'lg' | 'sm' }) {
  const cls =
    size === 'lg'
      ? 'px-8 py-3.5 text-[15px] rounded-full shadow-lg shadow-violet-500/30'
      : 'px-5 py-2 text-sm rounded-full shadow-md shadow-violet-500/25'
  return (
    <button
      onClick={onEnter}
      className={`group inline-flex shrink-0 items-center gap-2 whitespace-nowrap bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 font-semibold text-white transition-all duration-300 hover:shadow-xl hover:shadow-violet-500/40 hover:-translate-y-0.5 active:translate-y-0 ${cls}`}
    >
      立即体验
      <svg viewBox="0 0 24 24" className={`transition-transform duration-300 group-hover:translate-x-1 ${size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} {...stroke}>
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </svg>
    </button>
  )
}

/** 区块标题 */
function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-400">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h2>
      {sub && <p className="mt-4 text-[15px] leading-relaxed text-slate-400">{sub}</p>}
    </Reveal>
  )
}

/* ── 主组件 ──────────────────────────────────────────────────────────── */
export default function Landing({ onEnter, onAuth, leaving = false }: LandingProps) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  // 顶部阅读进度条：scroll 事件本身即帧节流，直接更新即可
  // （不包 rAF——后台/被遮挡标签页的 rAF 不触发，会导致进度条卡死）
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div
      className={`min-h-screen bg-[#05070F] text-slate-100 antialiased transition-all duration-300 ${
        leaving ? 'scale-[0.985] opacity-0' : 'opacity-100'
      } landing-root`}
    >
      {/* ── 阅读进度条 ── */}
      <div className="fixed inset-x-0 top-0 z-50 h-0.5 bg-white/[0.06]">
        <div
          className="h-full origin-left bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
      {/* ── 背景光晕与网格 ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[min(920px,120vw)] -translate-x-1/2 rounded-full bg-indigo-600/25 blur-[130px]" />
        <div className="absolute top-[42%] -right-48 h-[440px] w-[440px] rounded-full bg-fuchsia-600/15 blur-[120px]" />
        <div className="absolute bottom-[-120px] -left-40 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-100 [background-image:linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_65%_55%_at_50%_0%,#000_55%,transparent_100%)]"
        />
      </div>

      <div className="relative">
        {/* ══ 导航栏 ══ */}
        <header className="fixed inset-x-0 top-0 z-40 border-b border-white/[0.06] bg-[#05070F]/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
            <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-500/30">
                M
              </span>
              <span className="text-[15px] font-bold tracking-tight text-white">MarkDoc</span>
            </a>
            <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
              <button onClick={() => scrollTo('features')} className="transition-colors hover:text-white">核心功能</button>
              <button onClick={() => scrollTo('how')} className="transition-colors hover:text-white">快速上手</button>
              <button onClick={() => scrollTo('platforms')} className="transition-colors hover:text-white">使用方式</button>
            </nav>
            <div className="flex items-center gap-3">
              {accountEnabled && (
                <button
                  onClick={() => onAuth('login')}
                  className="hidden rounded-full px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white sm:block"
                >
                  登录
                </button>
              )}
              <CtaButton onEnter={onEnter} size="sm" />
            </div>
          </div>
        </header>

        {/* ══ 英雄区 ══ */}
        <section className="relative px-5 pt-36 pb-20 sm:px-8 sm:pt-44 sm:pb-28">
          <div className="mx-auto max-w-4xl text-center">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-slate-300 backdrop-blur">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                开源免费 · 所有转换在浏览器本地完成，内容不上传服务器
              </span>
            </Reveal>

            <Reveal delay={90}>
              <h1 className="mt-7 text-4xl font-extrabold leading-[1.15] tracking-tight text-white sm:text-6xl sm:leading-[1.12]">
                <span className="whitespace-nowrap">把 AI 回答，</span>
                <span className="whitespace-nowrap">一键变成</span>
                <br />
                <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                  排版好的 Word / PDF
                </span>
              </h1>
            </Reveal>

            <Reveal delay={180}>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
                粘贴 ChatGPT / DeepSeek / Kimi 的回答：LaTeX 公式在 Word 中原生可编辑、在 PDF 中矢量清晰，
                表格、代码、Mermaid 图表完整保留，PDF 文字可选中可搜索。
              </p>
            </Reveal>

            <Reveal delay={260}>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <CtaButton onEnter={onEnter} />
                <button
                  onClick={() => scrollTo('features')}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-8 py-3.5 text-[15px] font-medium text-slate-200 backdrop-blur transition-all hover:border-white/20 hover:bg-white/[0.07]"
                >
                  了解功能
                  <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke}>
                    <path d="M12 5v14m-6-6 6 6 6-6" />
                  </svg>
                </button>
              </div>
            </Reveal>

            <Reveal delay={340}>
              <p className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-400" {...stroke}><path d="M5 13l4 4L19 7" /></svg>
                  匿名免费试用 1 次
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-400" {...stroke}><path d="M5 13l4 4L19 7" /></svg>
                  注册后云端历史 · 导出不限次
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-400" {...stroke}><path d="M5 13l4 4L19 7" /></svg>
                  公式可编辑 · PDF 可搜索
                </span>
              </p>
            </Reveal>
          </div>

          {/* ── 产品窗口 mock：左编辑器 → 右 Word 文档 ── */}
          <Reveal delay={420} className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl shadow-indigo-950/60 backdrop-blur-xl">
              {/* 窗口栏 */}
              <div className="flex items-center border-b border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <span className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                </span>
                <span className="mx-auto rounded-md bg-white/5 px-4 py-1 text-[11px] text-slate-400">markdoc.app</span>
                <span className="w-12" />
              </div>
              {/* 双栏 */}
              <div className="grid grid-cols-1 gap-0 sm:grid-cols-2">
                {/* 编辑器 */}
                <div className="relative border-b border-white/[0.06] bg-[#0A0F1E]/80 p-5 font-mono text-[11px] leading-[1.9] sm:border-b-0 sm:border-r sm:p-6">
                  <p><span className="text-slate-600">1  </span><span className="text-violet-300">## 二次型与正定矩阵</span></p>
                  <p><span className="text-slate-600">2  </span><span className="text-slate-400">设 <span className="text-sky-300">$A$</span> 是实对称矩阵，</span></p>
                  <p><span className="text-slate-600">3  </span><span className="text-slate-400">则下列条件等价：</span></p>
                  <p className="mt-1"><span className="text-slate-600">4  </span><span className="text-emerald-300">{'$$\\int_{-\\infty}^{\\infty} e^{-x^2}dx = \\sqrt{\\pi}$$'}</span></p>
                  <p className="mt-1"><span className="text-slate-600">5  </span><span className="text-slate-400">| 模型 | 参数量 |</span></p>
                  <p><span className="text-slate-600">6  </span><span className="text-slate-400">| ---- | ------ |</span></p>
                  <p><span className="text-slate-600">7  </span><span className="text-slate-400">| A-7B | 32K  |</span></p>
                  <p className="mt-1"><span className="text-slate-600">8  </span><span className="text-amber-200">```mermaid</span></p>
                  <p><span className="text-slate-600">9  </span><span className="text-amber-200/80">graph TD; A→B→C;</span></p>
                  {/* 光标 */}
                  <span className="mt-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-indigo-400" />
                  {/* 转换徽标 */}
                  <span className="absolute -right-6 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center sm:flex">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/40 ring-4 ring-[#05070F]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" {...stroke}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
                    </span>
                  </span>
                </div>
                {/* Word 文档 */}
                <div className="bg-slate-100 p-5 sm:p-6">
                  <div className="mx-auto max-w-[300px] bg-white px-6 py-5 shadow-md ring-1 ring-slate-900/5">
                    <p className="text-center font-serif text-[13px] font-bold text-blue-700">二次型与正定矩阵</p>
                    <div className="mx-auto mt-1 h-0.5 w-10 bg-blue-600/70" />
                    <p className="mt-3 font-serif text-[10.5px] leading-relaxed text-slate-700">
                      设 A 是实对称矩阵，则下列条件等价：
                    </p>
                    <p className="my-2.5 text-center font-serif text-[13px] italic text-slate-900">
                      <span className="border-y border-slate-300 px-2 py-0.5">∫ e<sup>−x²</sup> dx = √π</span>
                    </p>
                    <table className="w-full border-collapse font-serif text-[10px] text-slate-700">
                      <thead>
                        <tr className="border-t-2 border-b border-slate-800 text-slate-900">
                          <th className="py-1 text-left font-semibold">模型</th>
                          <th className="py-1 text-left font-semibold">参数量</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-slate-300"><td className="py-1">A-7B</td><td className="py-1">32K</td></tr>
                        <tr className="border-b-2 border-slate-800"><td className="py-1">B-32B</td><td className="py-1">128K</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            {/* 漂浮特性徽标 */}
            <span className="landing-float absolute -right-3 -top-5 hidden rounded-xl border border-white/10 bg-[#0B1120]/90 px-3.5 py-2 text-xs text-slate-200 shadow-xl shadow-black/40 backdrop-blur lg:block">
              <span className="mr-1.5 text-indigo-300">ƒx</span>Word 公式双击可编辑
            </span>
            <span className="landing-float-delay absolute -left-3 -bottom-5 hidden rounded-xl border border-white/10 bg-[#0B1120]/90 px-3.5 py-2 text-xs text-slate-200 shadow-xl shadow-black/40 backdrop-blur lg:block">
              <span className="mr-1.5 text-fuchsia-300">PDF</span>文字可选中 · 可搜索
            </span>
          </Reveal>
        </section>

        {/* ══ 数据条 ══ */}
        <section className="px-5 sm:px-8">
          <Reveal className="mx-auto max-w-5xl">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-4">
              {[
                ['8 项', '导出核心能力'],
                ['3 套', '内置排版模板'],
                ['4 种', '全平台使用方式'],
                ['100%', '本地处理不上传'],
              ].map(([num, label]) => (
                <div key={label} className="bg-[#070A14] px-6 py-7 text-center transition-colors duration-300 hover:bg-[#0B1022]">
                  <p className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-2xl font-extrabold text-transparent sm:text-3xl">{num}</p>
                  <p className="mt-1.5 text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ══ 核心功能 ══ */}
        <section id="features" className="scroll-mt-24 px-5 pt-28 sm:px-8">
          <SectionHead
            eyebrow="Features"
            title={<>不只是格式转换，<span className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">是「能交出去」的排版</span></>}
            sub="公式、表格、图表、分页——导出的文档直接达到论文与报告的交付标准，不需要再手动修一遍。"
          />
          <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 4) * 80}>
                <div className="group h-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-indigo-400/30 hover:bg-white/[0.05] hover:shadow-xl hover:shadow-indigo-950/50">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-indigo-300 transition-colors group-hover:border-indigo-400/40 group-hover:text-indigo-200">
                    {f.icon}
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-white">{f.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ══ 三步上手 ══ */}
        <section id="how" className="scroll-mt-24 px-5 pt-28 sm:px-8">
          <SectionHead
            eyebrow="Workflow"
            title="三步，从 AI 回签到交付文档"
            sub="无需安装、无需配置，打开浏览器就能完成整套流程。"
          />
          <div className="relative mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-3">
            {/* 连接线 */}
            <div className="pointer-events-none absolute left-[16%] right-[16%] top-12 hidden h-px bg-gradient-to-r from-indigo-500/50 via-violet-500/50 to-fuchsia-500/50 md:block" />
            {STEPS.map((s, i) => (
              <Reveal key={s.no} delay={i * 120}>
                <div className="relative h-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-7 text-center md:text-left">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-violet-400/30 bg-gradient-to-br from-indigo-500/25 to-fuchsia-500/25 text-base font-bold text-violet-200">
                    {s.no}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-white">{s.title}</h3>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-slate-400">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ══ 四种使用方式 ══ */}
        <section id="platforms" className="scroll-mt-24 px-5 pt-28 sm:px-8">
          <SectionHead
            eyebrow="Everywhere"
            title="四种使用方式，一个不落"
            sub="同一套代码，功能完全同步：网页、手机、桌面、浏览器扩展。"
          />
          <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLATFORMS.map((p, i) => (
              <Reveal key={p.name} delay={i * 80}>
                <div className="relative h-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-center transition-colors hover:border-white/20 hover:bg-white/[0.05]">
                  {p.tag && (
                    <span className="absolute right-4 top-4 rounded-full bg-gradient-to-r from-indigo-500/20 to-fuchsia-500/20 px-2.5 py-0.5 text-[10px] font-medium text-indigo-300 ring-1 ring-indigo-400/30">
                      {p.tag}
                    </span>
                  )}
                  <span className="text-3xl">{p.icon}</span>
                  <h3 className="mt-3.5 text-[15px] font-semibold text-white">{p.name}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{p.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ══ 隐私与开源 ══ */}
        <section className="px-5 pt-28 sm:px-8">
          <Reveal className="mx-auto max-w-4xl">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-950/60 via-[#0A0F1E] to-fuchsia-950/40 p-8 text-center sm:p-12">
              <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[420px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-[90px]" />
              <span className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-500/10 text-emerald-300">
                <svg viewBox="0 0 24 24" className="h-7 w-7" {...stroke}>
                  <path d="M12 3l7.5 2.7v5.6c0 4.4-3 8.1-7.5 9.7-4.5-1.6-7.5-5.3-7.5-9.7V5.7L12 3z" />
                  <path d="M9 12l2.2 2.2L15.5 10" />
                </svg>
              </span>
              <h2 className="relative mt-6 text-2xl font-bold tracking-tight text-white sm:text-3xl">隐私优先：内容永远不出浏览器</h2>
              <p className="relative mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">
                所有转换（含 PDF 字体子集化）全部在浏览器本地完成，文档内容不上传服务器。
                项目完全开源，欢迎审查与共建。
              </p>
              <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-6 py-3 text-sm font-medium text-white transition-colors hover:border-white/30 hover:bg-white/[0.1]"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
                  GitHub 开源地址
                </a>
                <CtaButton onEnter={onEnter} size="sm" />
              </div>
            </div>
          </Reveal>
        </section>

        {/* ══ 页脚 ══ */}
        <footer className="mt-28 border-t border-white/[0.06] px-5 py-10 sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 text-sm text-slate-500 sm:flex-row">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-[10px] font-bold text-white">M</span>
              <span className="font-semibold text-slate-300">MarkDoc</span>
              <span className="text-slate-600">·</span>
              <span>把 AI 回答变成排版好的文档</span>
              <span className="text-slate-600">·</span>
              <span>© {new Date().getFullYear()}</span>
            </div>
            <div className="flex items-center gap-5 text-xs">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-slate-300">开源地址</a>
              {accountEnabled ? (
                <>
                  <button onClick={() => onAuth('login')} className="transition-colors hover:text-slate-300">登录</button>
                  <button onClick={() => onAuth('register')} className="transition-colors hover:text-slate-300">注册</button>
                </>
              ) : (
                <a href="./login.html" className="transition-colors hover:text-slate-300">账号入口</a>
              )}
              <a href="./privacy.html" target="_blank" rel="noreferrer" className="transition-colors hover:text-slate-300">隐私政策</a>
              <a href="./terms.html" target="_blank" rel="noreferrer" className="transition-colors hover:text-slate-300">服务条款</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
