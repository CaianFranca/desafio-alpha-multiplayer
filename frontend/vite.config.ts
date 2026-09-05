import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Mesma env var respeitada por getConfig() em packages/config
// (DEFAULT_LOBBY_SERVER_PORT = 3001 lá) e por resolverWsUrl() em
// web/src/hooks/useSalaWebSocket.ts (VITE_WS_URL > fallback dev 5173→3001).
const lobbyServerPort = process.env.LOBBY_SERVER_PORT ?? '3001'
// No container o proxy precisa mirar o service name (localhost do container
// é o próprio frontend-dev); no host local, o default localhost funciona.
// docker-compose.dev.yml define VITE_DEV_PROXY_LOBBY=http://lobby-server:3001.
const lobbyProxyTarget = process.env.VITE_DEV_PROXY_LOBBY ?? `http://localhost:${lobbyServerPort}`

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Os assets estáticos vivem em web/public (ex.: /assets/imagem_fundo_hero.png
  // usado como fundo da Hero/CTA final); o default <root>/public não existe.
  publicDir: 'web/public',
  // Resolve o pacote de DTOs compartilhado pelo nome canônico,
  // apontando para a fonte TS (browser-safe: só importamos DTOs puros, sem redis).
  resolve: {
    alias: {
      '@flicker/shared': fileURLToPath(new URL('../packages/shared', import.meta.url)),
    },
  },
  // Proxy dev para o lobby-server.
  server: {
    // No container (docker-compose.dev.yml), o Vite precisa escutar em
    // 0.0.0.0:5173 com porta fixa — o nginx-dev proxya :8080 -> :5173.
    // HMR sem config explícita: o cliente reconecta ao host da página
    // (:8080) e o nginx repassa o upgrade de WebSocket no `location /`.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': lobbyProxyTarget,
    },
  },
  // Constante de compilação para a dupla trava do mock de autenticação:
  // fora de produção vira `true`; em produção vira literal `false`, e o
  // minificador elimina a implementação mock do bundle final.
  define: {
    __MOCK_AUTH__: mode !== 'production',
  },
}))
