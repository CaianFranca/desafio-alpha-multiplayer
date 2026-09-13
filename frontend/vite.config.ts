import { fileURLToPath } from 'node:url'
import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
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

/** Tamanho do arquivo em bytes, ou null se não for arquivo legível. */
function tamanhoDoArquivo(caminho: string): number | null {
  try {
    const info = statSync(caminho)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

// Duto `/media/` no `npm run dev` puro (issue #228, B1 do review da PR #247):
// o proxy `/media/` só existe no nginx (compose/prod servem `web/media/`
// por bind-mount/tarball), então sem este middleware o som de recusa daria
// 404 no dev puro. Escopo restrito a `web/media/`, com trava anti
// path-traversal; fora de `serve` o plugin é inerte (`apply: 'serve'`).
function servirMediaNoDev(): Plugin {
  const raizDaMedia = fileURLToPath(new URL('./web/media', import.meta.url))
  return {
    name: 'servir-media-no-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        if (!req.url) return next()
        const semQuery = req.url.split('?')[0]
        if (!semQuery.startsWith('/media/')) return next()
        let relativo: string
        try {
          relativo = decodeURIComponent(semQuery.slice('/media/'.length))
        } catch {
          return next()
        }
        if (relativo === '' || relativo.split('/').includes('..')) return next()
        const resolvido = path.normalize(path.join(raizDaMedia, relativo))
        if (resolvido !== raizDaMedia && !resolvido.startsWith(raizDaMedia + path.sep)) {
          return next()
        }
        const tamanho = tamanhoDoArquivo(resolvido)
        if (tamanho === null) return next()
        const tipo =
          resolvido.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream'
        res.setHeader('Content-Type', tipo)
        res.setHeader('Content-Length', String(tamanho))
        res.setHeader('Accept-Ranges', 'bytes')
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        const fluxo = createReadStream(resolvido)
        fluxo.on('error', () => next())
        fluxo.pipe(res)
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  // Subpath de deploy (ex.: VITE_BASE_PATH=/server01/): o Vite injeta o valor
  // em import.meta.env.BASE_URL e reescreve os assets do bundle no build.
  // Ausente = '/' — deploy na raiz, comportamento inalterado.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), servirMediaNoDev()],
  // Os assets estáticos vivem em web/public (ex.: /assets/imagem_fundo_hero.webp
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
