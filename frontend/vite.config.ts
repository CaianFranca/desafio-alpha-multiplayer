import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Mesma env var respeitada por getConfig() em packages/config
// (DEFAULT_LOBBY_SERVER_PORT = 3001 lá).
const lobbyServerPort = process.env.LOBBY_SERVER_PORT ?? '3001'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Proxy dev para o lobby-server.
  server: {
    proxy: {
      '/api': `http://localhost:${lobbyServerPort}`,
    },
  },
  // Constante de compilação para a dupla trava do mock de autenticação:
  // fora de produção vira `true`; em produção vira literal `false`, e o
  // minificador elimina a implementação mock do bundle final.
  define: {
    __MOCK_AUTH__: mode !== 'production',
  },
}))
