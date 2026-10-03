import { create } from 'zustand'
import type { HiveEngine, Insets } from './engine'

interface SceneUI {
  engine: HiveEngine | null
  /** Space taken by overlays, keyed by owner, so the camera centres in the visible area. */
  insetSources: Record<string, Partial<Insets>>
  chatAnchor: { x: number; y: number } | null
  dimmed: boolean
  setEngine(e: HiveEngine | null): void
  setInset(owner: string, i: Partial<Insets> | null): void
  setChatAnchor(p: { x: number; y: number } | null): void
  setDimmed(v: boolean): void
}

export const useScene = create<SceneUI>()((set) => ({
  engine: null,
  insetSources: {},
  chatAnchor: null,
  dimmed: false,
  setEngine: (engine) => set({ engine }),
  setInset: (owner, i) =>
    set((s) => {
      const next = { ...s.insetSources }
      if (i) next[owner] = i
      else delete next[owner]
      return { insetSources: next }
    }),
  setChatAnchor: (chatAnchor) => set({ chatAnchor }),
  setDimmed: (dimmed) => set({ dimmed }),
}))

export function combineInsets(src: Record<string, Partial<Insets>>): Insets {
  const out: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const i of Object.values(src)) {
    out.top = Math.max(out.top, i.top ?? 0)
    out.right = Math.max(out.right, i.right ?? 0)
    out.bottom = Math.max(out.bottom, i.bottom ?? 0)
    out.left = Math.max(out.left, i.left ?? 0)
  }
  return out
}
