/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MOCK?: string
  /** Espelho de SESSION_ACCESS_TTL_SECONDS do servidor (slide-session, #376). */
  readonly VITE_SESSION_ACCESS_TTL_SECONDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Constante de compilação: `mode !== 'production'` (ver vite.config.ts). */
declare const __MOCK_AUTH__: boolean
