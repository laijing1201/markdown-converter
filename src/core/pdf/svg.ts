/**
 * SVG 子集走查器 —— 把 KaTeX 公式里的 <svg>（拉伸定界符/根号/括号等）
 * 转成 PDF 矢量路径。KaTeX 的 SVG 结构很简单：path + rect + use + g(transform)，
 * 这里只实现这个子集；遇到不支持的元素跳过并记录 warning。
 *
 * 输出统一为「舞台坐标」（px，原点 = 内容区左上角）下的 path 字符串，
 * 变换矩阵已烘焙进坐标点，PDF 渲染端无需再处理矩阵。
 */

export interface SvgPathOp {
  d: string
  fill: string | null
  stroke: string | null
  strokeWidth: number
}

export interface SvgResult {
  paths: SvgPathOp[]
  warnings: string[]
}

type Matrix = [number, number, number, number, number, number] // a b c d e f

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function compose(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function parseTransformAttr(s: string): Matrix {
  let m: Matrix = IDENTITY
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(s))) {
    const args = match[2].split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n))
    let next: Matrix = IDENTITY
    switch (match[1]) {
      case 'matrix':
        if (args.length >= 6) next = [args[0], args[1], args[2], args[3], args[4], args[5]]
        break
      case 'translate':
        next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]
        break
      case 'scale':
        next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]
        break
      case 'rotate': {
        const a = ((args[0] ?? 0) * Math.PI) / 180
        const cx = args[1] ?? 0
        const cy = args[2] ?? 0
        next = compose(
          compose([1, 0, 0, 1, cx, cy], [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]),
          [1, 0, 0, 1, -cx, -cy],
        )
        break
      }
    }
    m = compose(m, next)
  }
  return m
}

// ── path 解析与烘焙 ──────────────────────────────────────────────────────────

interface Cmd {
  cmd: string
  pts: number[][]
}

/** 把 path d 解析为命令序列（支持 M/L/H/V/C/S/Q/T/Z，A 近似为线段） */
function parsePath(d: string): Cmd[] {
  const out: Cmd[] = []
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g
  let m: RegExpExecArray | null
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  while ((m = re.exec(d))) {
    const cmd = m[1]
    const nums = m[2].trim().length ? m[2].trim().split(/[\s,]+/).map(Number) : []
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' && cmd !== 'Z'
    switch (cmd.toUpperCase()) {
      case 'M': {
        for (let i = 0; i < nums.length; i += 2) {
          const x = rel ? cx + nums[i] : nums[i]
          const y = rel ? cy + nums[i + 1] : nums[i + 1]
          if (i === 0) {
            out.push({ cmd: 'M', pts: [[x, y]] })
            sx = x; sy = y
          } else {
            out.push({ cmd: 'L', pts: [[x, y]] })
          }
          cx = x; cy = y
        }
        break
      }
      case 'L': {
        for (let i = 0; i < nums.length; i += 2) {
          const x = rel ? cx + nums[i] : nums[i]
          const y = rel ? cy + nums[i + 1] : nums[i + 1]
          out.push({ cmd: 'L', pts: [[x, y]] })
          cx = x; cy = y
        }
        break
      }
      case 'H': {
        for (const n of nums) {
          const x = rel ? cx + n : n
          out.push({ cmd: 'L', pts: [[x, cy]] })
          cx = x
        }
        break
      }
      case 'V': {
        for (const n of nums) {
          const y = rel ? cy + n : n
          out.push({ cmd: 'L', pts: [[cx, y]] })
          cy = y
        }
        break
      }
      case 'C': {
        for (let i = 0; i + 5 < nums.length; i += 6) {
          const dx = (x: number) => (rel ? cx + x : x)
          const dy = (y: number) => (rel ? cy + y : y)
          out.push({ cmd: 'C', pts: [[dx(nums[i]), dy(nums[i + 1])], [dx(nums[i + 2]), dy(nums[i + 3])], [dx(nums[i + 4]), dy(nums[i + 5])]] })
          cx = dx(nums[i + 4]); cy = dy(nums[i + 5])
        }
        break
      }
      case 'S': {
        for (let i = 0; i + 3 < nums.length; i += 4) {
          const dx = (x: number) => (rel ? cx + x : x)
          const dy = (y: number) => (rel ? cy + y : y)
          const prev = out[out.length - 1]
          const c1x = prev && prev.cmd === 'C' ? 2 * cx - prev.pts[1][0] : cx
          const c1y = prev && prev.cmd === 'C' ? 2 * cy - prev.pts[1][1] : cy
          out.push({ cmd: 'C', pts: [[c1x, c1y], [dx(nums[i]), dy(nums[i + 1])], [dx(nums[i + 2]), dy(nums[i + 3])]] })
          cx = dx(nums[i + 2]); cy = dy(nums[i + 3])
        }
        break
      }
      case 'Q': {
        for (let i = 0; i + 3 < nums.length; i += 4) {
          const dx = (x: number) => (rel ? cx + x : x)
          const dy = (y: number) => (rel ? cy + y : y)
          // 二次 → 三次贝塞尔
          const qx = dx(nums[i]); const qy = dy(nums[i + 1])
          const ex = dx(nums[i + 2]); const ey = dy(nums[i + 3])
          out.push({
            cmd: 'C',
            pts: [
              [cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy)],
              [ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey)],
              [ex, ey],
            ],
          })
          cx = ex; cy = ey
        }
        break
      }
      case 'T': {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const dx = (x: number) => (rel ? cx + x : x)
          const dy = (y: number) => (rel ? cy + y : y)
          const prev = out[out.length - 1]
          let qx = cx; let qy = cy
          if (prev && (prev.cmd === 'C' || prev.cmd === 'Q') && prev.pts.length >= 2) {
            const [pcx, pcy] = prev.cmd === 'Q' ? prev.pts[0] : prev.pts[1]
            qx = 2 * cx - pcx; qy = 2 * cy - pcy
          }
          const ex = dx(nums[i]); const ey = dy(nums[i + 1])
          out.push({
            cmd: 'C',
            pts: [
              [cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy)],
              [ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey)],
              [ex, ey],
            ],
          })
          cx = ex; cy = ey
        }
        break
      }
      case 'A': {
        // 椭圆弧：用弦线近似（KaTeX 字形几乎不使用 A；出现时弧度误差可接受）
        for (let i = 0; i + 6 < nums.length; i += 7) {
          const x = rel ? cx + nums[i + 5] : nums[i + 5]
          const y = rel ? cy + nums[i + 6] : nums[i + 6]
          out.push({ cmd: 'L', pts: [[x, y]] })
          cx = x; cy = y
        }
        break
      }
      case 'Z': {
        out.push({ cmd: 'Z', pts: [] })
        cx = sx; cy = sy
        break
      }
    }
  }
  return out
}

function bakePath(d: string, m: Matrix): string {
  const cmds = parsePath(d)
  const parts: string[] = []
  for (const c of cmds) {
    if (c.cmd === 'Z') {
      parts.push('Z')
      continue
    }
    const pts = c.pts.map(([x, y]) => {
      const [tx, ty] = apply(m, x, y)
      return `${round2(tx)} ${round2(ty)}`
    })
    parts.push(`${c.cmd} ${pts.join(' ')}`)
  }
  return parts.join(' ')
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ── 颜色解析 ─────────────────────────────────────────────────────────────────

export function parseSvgColor(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (!v || v === 'none' || v === 'transparent') return null
  if (v.startsWith('#')) {
    if (v.length === 4) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
    return v.slice(0, 7)
  }
  const rgb = v.match(/rgba?\(([^)]+)\)/)
  if (rgb) {
    const parts = rgb[1].split(/[\s,]+/).map(Number).slice(0, 3)
    return `#${parts.map((n) => clamp255(n).toString(16).padStart(2, '0')).join('')}`
  }
  const named: Record<string, string> = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
    gray: '#808080', grey: '#808080', currentcolor: '#000000',
  }
  return named[v] ?? null
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

// ── 主走查 ───────────────────────────────────────────────────────────────────

interface Ctx {
  result: SvgResult
  ownerSvg: SVGSVGElement
}

function styleFill(el: Element): string | null {
  const attr = el.getAttribute('fill')
  if (attr !== null) return parseSvgColor(attr)
  if (el instanceof SVGElement) {
    try {
      return parseSvgColor(getComputedStyle(el as Element as HTMLElement).fill)
    } catch { /* jsdom 等 */ }
  }
  return null
}

function styleStroke(el: Element): { color: string | null; width: number } {
  let color: string | null = null
  let width = 0
  const attrC = el.getAttribute('stroke')
  const attrW = el.getAttribute('stroke-width')
  if (attrC !== null) color = parseSvgColor(attrC)
  if (attrW !== null) width = parseFloat(attrW) || 0
  if (el instanceof SVGElement && (color === null || !width)) {
    try {
      const cs = getComputedStyle(el as Element as HTMLElement)
      if (color === null) color = parseSvgColor(cs.stroke)
      if (!width) width = parseFloat(cs.strokeWidth) || 0
    } catch { /* ignore */ }
  }
  return { color, width }
}

function shapeToPath(el: Element): string | null {
  const tag = el.tagName.toLowerCase()
  const num = (name: string): number => parseFloat(el.getAttribute(name) || '0') || 0
  switch (tag) {
    case 'rect': {
      const x = num('x'); const y = num('y'); const w = num('width'); const h = num('height')
      if (!w || !h) return null
      return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`
    }
    case 'line':
      return `M ${num('x1')} ${num('y1')} L ${num('x2')} ${num('y2')}`
    case 'circle': {
      const cx = num('cx'); const cy = num('cy'); const r = num('r')
      if (!r) return null
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
    }
    case 'ellipse': {
      const cx = num('cx'); const cy = num('cy'); const rx = num('rx'); const ry = num('ry')
      if (!rx || !ry) return null
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} Z`
    }
    case 'polyline':
    case 'polygon': {
      const ptsStr = el.getAttribute('points') || ''
      const nums = ptsStr.trim().split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n))
      if (nums.length < 4) return null
      const parts: string[] = []
      for (let i = 0; i + 1 < nums.length; i += 2) {
        parts.push(`${i === 0 ? 'M' : 'L'} ${nums[i]} ${nums[i + 1]}`)
      }
      if (tag === 'polygon') parts.push('Z')
      return parts.join(' ')
    }
    default:
      return null
  }
}

function walkNode(node: Element, ctm: Matrix, ctx: Ctx, depth: number) {
  if (depth > 24) return
  const tag = node.tagName.toLowerCase()
  if (tag === 'defs' || tag === 'style' || tag === 'script' || tag === 'title' || tag === 'desc' || tag === 'marker') return

  let localCtm = ctm
  const tf = node.getAttribute('transform')
  if (tf) localCtm = compose(ctm, parseTransformAttr(tf))

  if (tag === 'use') {
    const href = node.getAttribute('href') || node.getAttribute('xlink:href') || ''
    if (href.startsWith('#')) {
      // KaTeX 的字形 path 定义在页面级共享 <defs> 里，跨 <svg> 引用
      let target: Element | null = null
      try {
        target = ctx.ownerSvg.querySelector(href) ?? (node.ownerDocument as Document).querySelector(href)
      } catch { // 非法选择器（如以数字开头的 id）
        try {
          const id = href.slice(1)
          target = (node.ownerDocument as Document).getElementById(id)
        } catch { target = null }
      }
      if (target) {
        const dx = parseFloat(node.getAttribute('x') || '0') || 0
        const dy = parseFloat(node.getAttribute('y') || '0') || 0
        walkNode(target, compose(localCtm, [1, 0, 0, 1, dx, dy]), ctx, depth + 1)
      }
    }
    return
  }

  if (tag === 'path') {
    const d = node.getAttribute('d')
    if (d) {
      emitPath(d, node, localCtm, ctx)
    }
    return
  }

  const shapeD = shapeToPath(node)
  if (shapeD) {
    emitPath(shapeD, node, localCtm, ctx)
    return
  }

  if (tag === 'foreignobject') {
    ctx.result.warnings.push('svg foreignObject 不支持（已跳过）')
    return
  }

  // g / svg / 其他容器：递归
  Array.from(node.children).forEach((child) => walkNode(child, localCtm, ctx, depth + 1))
}

function emitPath(d: string, node: Element, ctm: Matrix, ctx: Ctx) {
  const fill = styleFill(node)
  const { color: stroke, width } = styleStroke(node)
  const baked = bakePath(d, ctm)
  if (!baked) return
  ctx.result.paths.push({
    d: baked,
    fill,
    stroke,
    strokeWidth: width,
  })
}

function viewBoxOf(svg: SVGSVGElement): { minX: number; minY: number; w: number; h: number } | null {
  const vb = svg.getAttribute('viewBox')
  if (!vb) return null
  const nums = vb.trim().split(/[\s,]+/).map(Number)
  if (nums.length !== 4 || nums.some((n) => Number.isNaN(n))) return null
  return { minX: nums[0], minY: nums[1], w: nums[2], h: nums[3] }
}

/**
 * 走查一个 SVG 元素，返回舞台坐标下的矢量路径。
 * @param svg        要走查的 <svg> 元素（须已挂载、已布局）
 * @param stageRect  舞台容器的 boundingRect（用于把页面坐标转成舞台坐标）
 */
export function walkSvg(svg: SVGSVGElement, stageRect: DOMRect): SvgResult {
  const result: SvgResult = { paths: [], warnings: [] }
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return result

  const vb = viewBoxOf(svg)
  if (!vb || vb.w <= 0 || vb.h <= 0) {
    // 无 viewBox：SVG 坐标即 CSS 像素坐标
    const ctm: Matrix = [1, 0, 0, 1, rect.left - stageRect.left, rect.top - stageRect.top]
    walkNode(svg, ctm, { result, ownerSvg: svg }, 0)
    return result
  }

  // preserveAspectRatio 默认 xMidYMid meet：均匀缩放并居中
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h)
  const offsetX = (rect.width - vb.w * scale) / 2
  const offsetY = (rect.height - vb.h * scale) / 2
  const ctm: Matrix = compose(
    [scale, 0, 0, scale, rect.left - stageRect.left + offsetX - vb.minX * scale, rect.top - stageRect.top + offsetY - vb.minY * scale],
    IDENTITY,
  )
  walkNode(svg, ctm, { result, ownerSvg: svg }, 0)
  return result
}
