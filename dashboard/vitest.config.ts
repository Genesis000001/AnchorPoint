import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Unit/component tests live under src. Playwright (e2e, tests/browser) and
    // Cypress specs run through their own runners and must not be collected here.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
