import { m } from 'framer-motion'
import type { ReactNode } from 'react'
import { useEscape, useReducedMotion } from '../lib/hooks'
import { IconButton } from './primitives'
import { cx } from '../lib/cx'
import { ViewInfo } from '../tour/ViewInfo'
import type { ViewKey } from '../tour/views'

/** A full-screen glass view over the dimmed hive (swarms, usage). */
export function Page({
  title,
  eyebrow,
  onClose,
  onBack,
  actions,
  children,
  className,
  label,
  onEscape,
  info,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  onClose: () => void
  onBack?: () => void
  actions?: ReactNode
  children: ReactNode
  className?: string
  label: string
  /** What Esc does when it should differ from Back/Close (e.g. back one step in a trail). */
  onEscape?: () => void
  /** The view's "What's this?" explainer. */
  info?: ViewKey
}) {
  const reduced = useReducedMotion()
  useEscape(onEscape ?? onBack ?? onClose)
  return (
    <m.section
      role="dialog"
      aria-label={label}
      initial={{ opacity: 0, y: reduced ? 0 : 24, scale: reduced ? 1 : 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : 16, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 34 }}
      className={cx(
        'fixed inset-0 z-[25] flex flex-col overflow-hidden md:inset-y-3 md:right-3 md:left-[84px] md:rounded-[24px] md:border md:border-line',
        className,
      )}
      style={{
        background: 'linear-gradient(180deg, rgb(10 10 32 / 0.9), rgb(6 6 22 / 0.94))',
        backdropFilter: 'blur(24px) saturate(140%)',
        WebkitBackdropFilter: 'blur(24px) saturate(140%)',
      }}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2 md:px-6 md:pt-4" style={{ paddingTop: 'calc(var(--sat) + 10px)' }}>
        {onBack && <IconButton icon="back" label="Back" onClick={onBack} />}
        <div className="min-w-0 flex-1 px-1">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className="truncate font-display text-[22px] font-semibold tracking-tight md:text-[26px]">{title}</h1>
        </div>
        {actions}
        {info && <ViewInfo view={info} />}
        <IconButton icon="x" label="Close" onClick={onClose} />
      </header>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </m.section>
  )
}
