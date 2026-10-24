/**
 * 工具栏线性图标集 —— 与 AuthModal 的 Icon 同一风格体系
 *（stroke = currentColor / 1.8 / round，自动适配明暗主题），
 * 取代各处混用的 emoji 图标，统一专业观感。
 */
import type { ReactNode } from 'react'

export interface ToolIconProps {
  className?: string
}

function Svg({ className = 'h-4 w-4', children }: ToolIconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** 链接（链接导入 / 滚动同步开启） */
export const LinkIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43" />
    <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33" />
  </Svg>
)

/** 断链（滚动同步关闭） */
export const UnlinkIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <path d="m3 3 18 18" />
    <path d="M8 8H7.5A4.5 4.5 0 0 0 3 12.5 4.5 4.5 0 0 0 7.5 17H9" />
    <path d="M16 8h.5A4.5 4.5 0 0 1 21 12.5a4.5 4.5 0 0 1-3 4.24" />
    <path d="M13 6.5 15.5 4M10.5 19.5 8 17" />
  </Svg>
)

/** 魔法棒（修复格式） */
export const WandIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <path d="m5 19 9.5-9.5" />
    <path d="m15.5 4.5 1 1M19 8l1 1M18 3l.5 1.5L20 5l-1.5.5L18 7l-.5-1.5L16 5l1.5-.5L18 3ZM6 4l.4 1.1L7.5 5.5l-1.1.4L6 7l-.4-1.1L4.5 5.5l1.1-.4L6 4Z" />
  </Svg>
)

/** 星光（智能排版） */
export const SparklesIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2 12 3.5Z" />
    <path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7 18.5 15.5Z" />
    <path d="M5 14.5 5.5 16 7 16.5 5.5 17 5 18.5 4.5 17 3 16.5 4.5 16 5 14.5Z" />
  </Svg>
)

/** 拼图（AI 修复） */
export const PuzzleIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <path d="M10 4.5a1.8 1.8 0 1 1 3.6 0c0 .6-.3 1-.3 1.5h3.4c.7 0 1.3.6 1.3 1.3v3.1c.5-.1.9-.4 1.5-.4a1.8 1.8 0 1 1 0 3.6c-.6 0-1-.3-1.5-.3v3.6c0 .7-.6 1.3-1.3 1.3h-3.1c.1-.5.4-.9.4-1.5a1.8 1.8 0 1 0-3.6 0c0 .6.3 1 .3 1.5H7.3c-.7 0-1.3-.6-1.3-1.3v-3.4c-.5 0-.9.3-1.5.3a1.8 1.8 0 1 1 0-3.6c.6 0 1 .3 1.5.3V7.3C6 6.6 6.6 6 7.3 6H9.7c0-.5-.3-.9-.3-1.5Z" />
  </Svg>
)

/** 齿轮（高级设置） */
export const GearIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2M12 18.5v2M4.9 7.5l1.7 1M17.4 15.5l1.7 1M4.9 16.5l1.7-1M17.4 8.5l1.7-1" />
  </Svg>
)

/** 时钟（历史） */
export const ClockIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)

/** 纸箱（批量转换） */
export const PackageIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <path d="M20.5 8.5v7a1.5 1.5 0 0 1-.8 1.3l-6.7 3.6a1.5 1.5 0 0 1-1.4 0l-6.7-3.6a1.5 1.5 0 0 1-.8-1.3v-7a1.5 1.5 0 0 1 .8-1.3l6.7-3.6a1.5 1.5 0 0 1 1.4 0l6.7 3.6a1.5 1.5 0 0 1 .8 1.3Z" />
    <path d="m4 7.8 8 4.3 8-4.3M12 21v-8.9" />
  </Svg>
)

/** 显示器（桌面版） */
export const MonitorIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="12" rx="1.8" />
    <path d="M9 20.5h6M12 16.5v4" />
  </Svg>
)

/** 太阳（亮色切换） */
export const SunIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4" />
  </Svg>
)

/** 月亮（暗色切换） */
export const MoonIcon = (p: ToolIconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Svg>
)
