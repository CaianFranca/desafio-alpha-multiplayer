import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// O vite.config virou uma função por causa do `define` dependente de modo;
// resolvemos com mode 'test' para herdar os plugins e constantes no Vitest.
const baseConfig = await viteConfig({ command: 'serve', mode: 'test', isSsrBuild: false })

export default mergeConfig(
  baseConfig,
  defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
  },
})
)
