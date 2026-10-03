import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/cx'
import { useEscape } from '../lib/hooks'
import { Icon } from '../ui/Icon'
import { Button } from '../ui/primitives'
import { useIntro } from './introStore'
import { KEYS, readKey, writeKey } from './storage'
import { VIEW_HELP, type ViewKey } from './views'

/** Hints already shown in this page, for when storage cannot remember them. */
const shownThisPage = new Set<string>()

function hintPending(key: string): boolean {
  return !shownThisPage.has(key) && !readKey(KEYS.hint(key))
}

function markHint(key: string): void {
  shownThisPage.add(key)
  writeKey(KEYS.hint(key), '1')
}

type Place = { top?: number; bottom?: number; right: number; width: number }

function placeFor(el: HTMLElement | null, width: number): Place | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const w = Math.min(width, vw - 24)
  // right-align to the button, kept inside the viewport
  const right = Math.max(12, Math.min(vw - r.right, vw - w - 12))
  const below = window.innerHeight - r.bottom
  return below > 220 || below > r.top ? { top: r.bottom + 8, right, width: w } : { bottom: window.innerHeight - r.top + 8, right, width: w }
}

/**
 * The small "What's this?" button every main view carries: a short card on what the view is for, with
 * "Show me" to play just its tour chapter. The first time a person opens the view on their own, a gentle
 * one-line hint appears beside it (remembered per view, when storage allows).
 */
export function ViewInfo({ view, className, size = 'md' }: { view: ViewKey; className?: string; size?: 'sm' | 'md' }) {
  const help = VIEW_HELP[view]
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState(false)
  const [place, setPlace] = useState<Place | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const busy = useIntro((s) => s.welcome || !!s.tour)
  const startTour = useIntro((s) => s.startTour)

  // the first-visit hint: once per view, never over the welcome or during the tour
  useEffect(() => {
    if (busy || !hintPending(help.hintKey)) return
    const show = setTimeout(() => {
      if (!hintPending(help.hintKey)) return
      markHint(help.hintKey)
      setHint(true)
    }, 1100)
    return () => clearTimeout(show)
  }, [busy, help.hintKey])
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(false), 9000)
    return () => clearTimeout(t)
  }, [hint])
  useEffect(() => {
    if (busy) {
      setHint(false)
      setOpen(false)
    }
  }, [busy])

  useLayoutEffect(() => {
    if (!open && !hint) return
    const update = () => setPlace(placeFor(btn.current, open ? 340 : 300))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open, hint])

  useEscape(() => setOpen(false), open)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!card.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  const toggle = () => {
    setHint(false)
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={btn}
        onClick={toggle}
        aria-label={`What's this? About ${help.title.toLowerCase()}`}
        aria-expanded={open}
        title="What's this?"
        data-tour={`info-${view}`}
        className={cx(
          'relative inline-flex shrink-0 items-center justify-center rounded-xl text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink',
          size === 'sm' ? 'size-9' : 'size-11',
          open && 'bg-white/[0.08] text-ink',
          className,
        )}
      >
        <Icon name="question" size={size === 'sm' ? 17 : 19} />
        {hint && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent-2 shadow-[0_0_8px_#6ee7ff]" aria-hidden="true" />}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && place && (
            <m.div
              ref={card}
              key="card"
              role="dialog"
              aria-label={`What's this: ${help.title}`}
              initial={{ opacity: 0, y: place.top !== undefined ? -6 : 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 560, damping: 38 }}
              className="glass-strong fixed z-[75] rounded-[20px] p-4"
              style={{ top: place.top, bottom: place.bottom, right: place.right, width: place.width, transformOrigin: place.top !== undefined ? 'top right' : 'bottom right' }}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="eyebrow">What's this?</div>
                  <h2 className="mt-1 font-display text-[17px] font-semibold tracking-tight text-ink">{help.title}</h2>
                </div>
                <button onClick={() => setOpen(false)} className="-mt-1 -mr-1.5 flex size-9 items-center justify-center rounded-lg text-ink-3 hover:bg-white/[0.06] hover:text-ink" aria-label="Close">
                  <Icon name="x" size={16} />
                </button>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{help.body}</p>
              <div className="mt-3.5 flex items-center gap-2">
                <Button
                  variant="primary"
                  icon="play"
                  className="min-h-10 px-3.5 text-[13px]"
                  onClick={() => {
                    setOpen(false)
                    startTour({ chapter: help.chapter, only: true })
                  }}
                >
                  Show me
                </Button>
                <button
                  onClick={() => {
                    setOpen(false)
                    startTour({})
                  }}
                  className="min-h-10 rounded-xl px-3 text-[13px] font-medium text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
                >
                  Full tour
                </button>
              </div>
            </m.div>
          )}
          {hint && !open && place && (
            <m.div
              key="hint"
              role="status"
              initial={{ opacity: 0, y: place.top !== undefined ? -4 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="glass-strong fixed z-[74] flex items-center gap-1 rounded-2xl py-1 pr-1 pl-3"
              style={{ top: place.top, bottom: place.bottom, right: place.right, maxWidth: place.width }}
            >
              <button onClick={toggle} className="min-h-9 min-w-0 flex-1 text-left text-[12.5px] leading-snug text-ink-2 hover:text-ink">
                {help.hint} <span className="font-semibold whitespace-nowrap text-accent-2">What's this?</span>
              </button>
              <button onClick={() => setHint(false)} className="flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-4 hover:bg-white/[0.06] hover:text-ink" aria-label="Dismiss hint">
                <Icon name="x" size={14} />
              </button>
            </m.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
