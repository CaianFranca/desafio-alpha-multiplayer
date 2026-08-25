import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Proxy dev para o lobby-server (DEFAULT_LOBBY_SERVER_PORT em packages/config).
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  // Constante de compilação para a dupla trava do mock de autenticação:
  // fora de produção vira `true`; em produção vira literal `false`, e o
  // minificador elimina a implementação mock do bundle final.
  define: {
    __MOCK_AUTH__: mode !== 'production',
  },
}))
