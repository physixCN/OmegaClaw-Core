/** Agent hues are the identity colour everywhere. These helpers keep them luminous but legible. */
export const hsl = (h: number, s = 90, l = 66, a = 1) =>
  a >= 1 ? `hsl(${Math.round(h)} ${s}% ${l}%)` : `hsl(${Math.round(h)} ${s}% ${l}% / ${a})`

export const hueGlow = (h: number) => hsl(h, 95, 68)
export const hueSoft = (h: number, a = 0.18) => hsl(h, 90, 60, a)

/** hsl → rgb (0-255) for canvas work. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))]
}

/**
 * Diverging scale for belief frequency: f=0 (false) warm red, f=0.5 neutral, f=1 (true) cool blue.
 * Poles from the dataviz reference diverging pair (blue <-> red), lifted for a dark, glowing surface;
 * the midpoint is a neutral lavender-grey so "undecided" reads as nothing.
 */
const NEG: [number, number, number] = [238, 104, 104]
const MID: [number, number, number] = [176, 174, 196]
const POS: [number, number, number] = [92, 162, 245]
export function freqRgb(f: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, f))
  const [a, b, u] = t < 0.5 ? [NEG, MID, t / 0.5] : [MID, POS, (t - 0.5) / 0.5]
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * u)) as [number, number, number]
}
export const freqColor = (f: number, a = 1) => {
  const [r, g, b] = freqRgb(f)
  return a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`
}
export const FREQ_GRADIENT = `linear-gradient(90deg, ${freqColor(0)}, ${freqColor(0.5)}, ${freqColor(1)})`
