import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Run tests in Node.js environment
    environment: 'node',

    // Test file patterns
    include: ['tests/e2e/**/*.test.ts'],

    // Long timeout for LLM API calls (3 minutes per test)
    testTimeout: 180000,

    // Hook timeout for beforeAll/afterAll (5 minutes for conversion)
    hookTimeout: 300000,

    // Run tests sequentially to avoid API rate limits
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Global setup
    setupFiles: ['tests/setup/vitest.setup.ts'],

    // Reporter
    reporters: ['verbose'],
  },
})
