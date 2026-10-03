/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HIVE_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __hiveScene?: { screenPos(id: string): { x: number; y: number; r: number } | null; focus(id: string): void }
  /** Sim mode only: the in-browser hive, to act as another client. */
  __hiveSim?: import('./api/client').HiveClient
}
