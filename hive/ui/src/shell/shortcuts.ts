import { useEffect } from 'react'
import { isTypingTarget } from '../lib/hooks'
import { navigate } from '../lib/router'
import { useHive } from '../store/store'

/** Global keyboard shortcuts: ⌘K / Ctrl+K, g h, g s, g i, g g, g u, g l, g p, n, /. Esc is handled by the escape stack. */
export function useShortcuts(): void {
  useEffect(() => {
    let g = 0
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault()
        const s = useHive.getState()
        s.setPalette(!s.paletteOpen)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (useHive.getState().paletteOpen) return
      const now = performance.now()
      if (g && now - g < 1200) {
        g = 0
        if (k === 'h') navigate({ name: 'hive' })
        else if (k === 's') navigate({ name: 'swarms' })
        else if (k === 'u') navigate({ name: 'usage' })
        else if (k === 'i') navigate({ name: 'approvals' })
        else if (k === 'g') navigate({ name: 'goals' })
        else if (k === 'l') navigate({ name: 'lab' })
        else if (k === 'p') navigate({ name: 'programs' })
        else return
        e.preventDefault()
        return
      }
      if (k === 'g') {
        g = now
        return
      }
      if (k === 'n') {
        e.preventDefault()
        navigate({ name: 'new' })
      } else if (k === '/') {
        e.preventDefault()
        useHive.getState().setPalette(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
