import type { SVGProps } from 'react'

const PATHS = {
  hive: 'M12 2.5 20.2 7.25v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z',
  swarms: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M4.5 12c0-2.2 3.4-4 7.5-4s7.5 1.8 7.5 4-3.4 4-7.5 4-7.5-1.8-7.5-4Z M8.2 5.5c1.9-1.1 5.6 1 8.2 4.8s3.3 7.5 1.4 8.6',
  plus: 'M12 5v14 M5 12h14',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M21 20H3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4',
  x: 'M6 6l12 12 M18 6 6 18',
  play: 'M7 5v14l11-7L7 5Z',
  stop: 'M7 7h10v10H7z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  send: 'M5 12h13 M13 6l6 6-6 6',
  copy: 'M9 9h10v10H9z M5 15V5h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z',
  terminal: 'M4 5h16v14H4z M7.5 9.5 10 12l-2.5 2.5 M12.5 14.5h4',
  cpu: 'M7 7h10v10H7z M9.5 9.5h5v5h-5z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4',
  alert: 'M12 8v5 M12 16.5v.5 M10.3 3.8 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5 M12 7.5v.5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z M14 6l4 4',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z',
  locate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4 M8 11h6 M11 8v6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4 M8 11h6',
  dice: 'M5 5h14v14H5z M9 9h.01 M15 15h.01 M15 9h.01 M9 15h.01 M12 12h.01',
  shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  table: 'M4 5h16v14H4z M4 10h16 M4 14.5h16 M10 5v14',
  power: 'M12 3v8 M6.3 6.8a8 8 0 1 0 11.4 0',
  wave: 'M2 12c2.5 0 2.5-5 5-5s2.5 10 5 10 2.5-10 5-10 2.5 5 5 5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0',
  logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
  keyboard: 'M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20, strokeWidth = 1.7, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
