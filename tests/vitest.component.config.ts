import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/components/**/*.test.tsx',
    ],
    setupFiles: ['./tests/setup/component.setup.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
