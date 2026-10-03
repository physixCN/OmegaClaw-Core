import { AnimatePresence, m } from 'framer-motion'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Belief } from '../../api/types'
import { freqColor, FREQ_GRADIENT, hsl } from '../../lib/color'
import { useNow } from '../../lib/hooks'
import { pulseKey } from '../../store/reducer'
import { MeTTa } from '../../ui/MeTTa'
import { cx } from '../../lib/cx'

interface Star {
  b: Belief
  x: number
  y: number
  r: number
  terms: string[]
}

const W = 1000
const H = 720

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

function termsOf(statement: string): string[] {
  return statement
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !/^(-->|==>|<->|<=>|×|&&|\|\||[$?#].*)$/.test(t))
}

/**
 * Lay out beliefs as a constellation: confident beliefs gather near the commons core,
 * uncertain ones drift to the rim. A few relaxation passes keep stars from overlapping.
 */
function layout(beliefs: Belief[], aspect: number): Star[] {
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W / 2, H / 2) * 0.86
  const sx = aspect < 1 ? 0.78 : 1.15
  const stars: Star[] = beliefs.map((b) => {
    const a = hash(b.statement) * Math.PI * 2
    const rad = R * (0.2 + (1 - b.tv.c) * 0.78)
    return {
      b,
      x: cx + Math.cos(a) * rad * sx,
      y: cy + Math.sin(a) * rad * (aspect < 1 ? 1.08 : 0.92),
      r: 4 + b.tv.c * 7 + Math.min(4, b.sources.length * 0.8),
      terms: termsOf(b.statement),
    }
  })
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const A = stars[i]
        const B = stars[j]
        const dx = B.x - A.x
        const dy = B.y - A.y
        const d = Math.hypot(dx, dy) || 0.01
        const min = A.r + B.r + 46
        if (d < min) {
          const push = (min - d) / 2
          A.x -= (dx / d) * push
          A.y -= (dy / d) * push
          B.x += (dx / d) * push
          B.y += (dy / d) * push
        }
      }
      const s = stars[i]
      const dc = Math.hypot(s.x - cx, s.y - cy)
      if (dc < 70) {
        s.x = cx + ((s.x - cx) / (dc || 1)) * 70
        s.y = cy + ((s.y - cy) / (dc || 1)) * 70
      }
      s.x = Math.min(W - 30, Math.max(30, s.x))
      s.y = Math.min(H - 30, Math.max(30, s.y))
    }
  }
  return stars
}

export function Constellation({
  beliefs,
  hue,
  selected,
  onSelect,
  pulses,
  swarmId,
  aspect,
}: {
  beliefs: Belief[]
  hue: number
  selected?: string
  onSelect: (statement: string) => void
  pulses: Record<string, number>
  swarmId: string
  aspect: number
}) {
  // positions are stable per statement: recompute only when the set of statements changes
  const keyset = beliefs.map((b) => b.statement).sort().join('\n')
  const base = useMemo(() => layout(beliefs, aspect), [keyset, aspect]) // eslint-disable-line react-hooks/exhaustive-deps
  const stars = useMemo(() => {
    const byStmt = new Map(beliefs.map((b) => [b.statement, b]))
    return base.map((s) => {
      const b = byStmt.get(s.b.statement) ?? s.b
      return { ...s, b, r: 4 + b.tv.c * 7 + Math.min(4, b.sources.length * 0.8) }
    })
  }, [base, beliefs])
  const [hover, setHover] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const now = useNow(1000)

  const links = useMemo(() => {
    const out: [Star, Star][] = []
    for (let i = 0; i < stars.length; i++) {
      const cands: { j: number; d: number }[] = []
      for (let j = 0; j < stars.length; j++) {
        if (i === j) continue
        if (!stars[i].terms.some((t) => stars[j].terms.includes(t))) continue
        cands.push({ j, d: Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y) })
      }
      cands.sort((a, b) => a.d - b.d)
      for (const c of cands.slice(0, 2)) if (c.j > i) out.push([stars[i], stars[c.j]])
    }
    return out
  }, [stars])

  // label the most confident stars whose labels do not collide with each other or with other stars
  const labelled = useMemo(() => {
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
    const out = new Set<string>()
    for (const s of [...stars].sort((a, b) => b.b.tv.c - a.b.tv.c)) {
      if (out.size >= 6) break
      const text = s.b.statement.length > 30 ? 30 : s.b.statement.length
      const w = text * 8.6
      const box = { x0: s.x - w / 2, y0: s.y + s.r + 6, x1: s.x + w / 2, y1: s.y + s.r + 26 }
      const hitsLabel = boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)
      const hitsStar = stars.some((o) => o !== s && o.x + o.r > box.x0 && o.x - o.r < box.x1 && o.y + o.r > box.y0 && o.y - o.r < box.y1)
      if (hitsLabel || hitsStar || box.x0 < 0 || box.x1 > W) continue
      boxes.push(box)
      out.add(s.b.statement)
    }
    return out
  }, [stars])
  const hovered = stars.find((s) => s.b.statement === hover)

  const onKey = (e: KeyboardEvent, s: Star) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(s.b.statement)
    }
  }

  return (
    <div ref={wrap} className="relative h-full w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${beliefs.length} beliefs in the commons`}>
        <defs>
          <radialGradient id="core-g">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.15" stopColor={hsl(hue, 100, 80)} />
            <stop offset="0.5" stopColor={hsl(hue, 90, 60, 0.25)} />
            <stop offset="1" stopColor={hsl(hue, 90, 50, 0)} />
          </radialGradient>
          {/* one soft glow per frequency bucket (diverging scale) */}
          {Array.from({ length: 11 }, (_, k) => (
            <radialGradient key={k} id={`sg-${k}`}>
              <stop offset="0" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.12" stopColor={freqColor(k / 10)} stopOpacity="0.95" />
              <stop offset="0.35" stopColor={freqColor(k / 10)} stopOpacity="0.35" />
              <stop offset="0.7" stopColor={freqColor(k / 10)} stopOpacity="0.08" />
              <stop offset="1" stopColor={freqColor(k / 10)} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        {/* confidence rings: the closer to the core, the more confident */}
        {[0.25, 0.5, 0.75].map((c) => {
          const R = Math.min(W / 2, H / 2) * 0.86 * (0.2 + (1 - c) * 0.78)
          return (
            <g key={c}>
              <ellipse cx={W / 2} cy={H / 2} rx={R * (aspect < 1 ? 0.78 : 1.15)} ry={R * (aspect < 1 ? 1.08 : 0.92)} fill="none" stroke="rgb(180 180 255 / 0.07)" />
              <text x={W / 2 + R * (aspect < 1 ? 0.78 : 1.15) * 0.71 + 6} y={H / 2 - R * (aspect < 1 ? 1.08 : 0.92) * 0.71 - 6} className="fill-ink-4 font-mono" fontSize="12" opacity={0.7}>
                c {c.toFixed(2)}
              </text>
            </g>
          )
        })}
        <circle cx={W / 2} cy={H / 2} r={90} fill="url(#core-g)" opacity={0.9} />
        <g stroke="rgb(200 200 255 / 0.11)" strokeWidth={1}>
          {links.map(([a, b], i) => (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} opacity={hover && (a.b.statement === hover || b.b.statement === hover) ? 3.5 : 1} />
          ))}
        </g>
        {stars.map((s, i) => {
          const sel = s.b.statement === selected
          const hov = s.b.statement === hover
          const color = freqColor(s.b.tv.f)
          const pulseAt = pulses[pulseKey(swarmId, s.b.statement)]
          const pulsing = pulseAt && now - pulseAt < 2500
          return (
            <m.g
              key={s.b.statement}
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1, x: s.x, y: s.y }}
              transition={{ type: 'spring', stiffness: 120, damping: 18, delay: Math.min(0.6, i * 0.015) }}
              role="button"
              tabIndex={0}
              aria-label={`${s.b.statement}, frequency ${s.b.tv.f.toFixed(2)}, confidence ${s.b.tv.c.toFixed(2)}`}
              aria-pressed={sel}
              onClick={() => onSelect(s.b.statement)}
              onKeyDown={(e) => onKey(e, s)}
              onPointerEnter={() => setHover(s.b.statement)}
              onPointerLeave={() => setHover((h) => (h === s.b.statement ? null : h))}
              onFocus={() => setHover(s.b.statement)}
              onBlur={() => setHover(null)}
              className="cursor-pointer outline-none"
              style={{ originX: 0, originY: 0 }}
            >
              <circle r={28} fill="transparent" />
              {pulsing && <circle key={pulseAt} r={4} fill="none" stroke={color} strokeWidth={2} style={{ animation: 'star-pulse 1.6s ease-out forwards' }} />}
              <circle r={s.r * (hov || sel ? 4.6 : 3.8)} fill={`url(#sg-${Math.round(s.b.tv.f * 10)})`} opacity={0.3 + s.b.tv.c * 0.7} style={{ transition: 'r 0.25s' }} />
              <circle r={Math.max(1.6, s.r * 0.42)} fill={color} opacity={0.6 + s.b.tv.c * 0.4} />
              <circle r={Math.max(1, s.r * 0.22)} fill="#fff" opacity={0.4 + s.b.tv.c * 0.6} />
              {s.b.tv.c > 0.75 && (
                <g stroke="#fff" strokeWidth={0.8} opacity={0.25 + (s.b.tv.c - 0.75) * 2}>
                  <line x1={-s.r * 2.2} x2={s.r * 2.2} y1={0} y2={0} />
                  <line y1={-s.r * 2.2} y2={s.r * 2.2} x1={0} x2={0} />
                </g>
              )}
              {sel && <circle r={s.r + 9} fill="none" stroke="#fff" strokeWidth={1.5} strokeDasharray="4 5" opacity={0.85} />}
              {(labelled.has(s.b.statement) || sel) && (
                <text y={s.r + 20} textAnchor="middle" fontSize={15} className="pointer-events-none fill-ink-2 font-mono" opacity={0.85}>
                  {s.b.statement.length > 30 ? `${s.b.statement.slice(0, 29)}…` : s.b.statement}
                </text>
              )}
            </m.g>
          )
        })}
      </svg>
      <AnimatePresence>
        {hovered && (
          <m.div
            key={hovered.b.statement}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="glass-strong pointer-events-none absolute z-10 max-w-[280px] -translate-x-1/2 rounded-xl px-3 py-2"
            style={{ left: `${(hovered.x / W) * 100}%`, top: `calc(${(hovered.y / H) * 100}% + 18px)` }}
          >
            <div className="text-[13px]">
              <MeTTa src={hovered.b.statement} />
            </div>
            <div className="mt-1 font-mono text-[11px] text-ink-3">
              <span className="text-ink">f {hovered.b.tv.f.toFixed(2)}</span> · <span className="text-ink">c {hovered.b.tv.c.toFixed(2)}</span> · {hovered.b.sources.length} source{hovered.b.sources.length === 1 ? '' : 's'}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ConstellationLegend({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-3', className)}>
      <div className="flex items-center gap-2">
        <span>Frequency</span>
        <span className="font-mono">0</span>
        <span className="h-1.5 w-24 rounded-full" style={{ background: FREQ_GRADIENT }} aria-hidden="true" />
        <span className="font-mono">1</span>
      </div>
      <div className="flex items-center gap-2">
        <span>Confidence</span>
        <span className="flex items-center gap-1" aria-hidden="true">
          {[0.2, 0.5, 0.9].map((c) => (
            <span key={c} className="rounded-full bg-white" style={{ width: 4 + c * 6, height: 4 + c * 6, opacity: 0.3 + c * 0.7, boxShadow: `0 0 ${c * 10}px rgb(255 255 255 / ${c})` }} />
          ))}
        </span>
        <span>brighter, nearer the core</span>
      </div>
    </div>
  )
}
