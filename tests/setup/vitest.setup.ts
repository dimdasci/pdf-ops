import { beforeAll } from 'vitest';

beforeAll(() => {
  // Ensure GEMINI_API_KEY is available
  if (!process.env.GEMINI_API_KEY) {
    console.warn('Warning: GEMINI_API_KEY environment variable is not set.');
    console.warn('E2E tests require a valid Gemini API key to run conversions.');
  }
});
