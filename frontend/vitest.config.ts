import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
  },
})
)
