import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: [
    'integration/**/*.test.ts',
    'workflows/**/*.test.ts',
  ],
  timeout: 60000,
  retries: 1,
  workers: 1, // Electron tests must run serially
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'integration',
      testMatch: 'integration/**/*.test.ts',
      timeout: 30000,
    },
    {
      name: 'workflows',
      testMatch: 'workflows/**/*.test.ts',
      timeout: 300000, // 5 min for LLM calls
    },
  ],
})
