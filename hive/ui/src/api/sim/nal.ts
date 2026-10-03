import type { TruthValue } from '../types'

/** Evidential horizon k = 1 (standard NAL). */
const K = 1

export const toWeight = (c: number) => (K * c) / (1 - Math.min(c, 0.9999))
export const toConfidence = (w: number) => w / (w + K)

/** NAL revision of two truth values derived from disjoint evidence. */
export function revise(a: TruthValue, b: TruthValue): TruthValue {
  const w1 = toWeight(a.c)
  const w2 = toWeight(b.c)
  const w = w1 + w2
  return { f: (w1 * a.f + w2 * b.f) / w, c: toConfidence(w) }
}

export function overlaps(a: string[], b: string[]): boolean {
  const s = new Set(a)
  return b.some((x) => s.has(x))
}

/** Unique union preserving order, capped to the newest `cap` entries. */
export function unionCapped(a: string[], b: string[], cap = 12): string[] {
  const out = [...new Set([...a, ...b])]
  return out.length > cap ? out.slice(out.length - cap) : out
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000
