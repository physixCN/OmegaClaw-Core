/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HIVE_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
