/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Constante de compilação: `mode !== 'production'` (ver vite.config.ts). */
declare const __MOCK_AUTH__: boolean
