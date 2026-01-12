import { beforeAll } from 'vitest';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables from .env file
config({ path: path.resolve(__dirname, '../../.env') });

beforeAll(() => {
  // Ensure GEMINI_API_KEY is available
  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY environment variable is not set.');
    console.error('E2E tests require a valid Gemini API key to run conversions.');
    console.error('');
    console.error('To fix this:');
    console.error('1. Copy .env.example to .env');
    console.error('2. Add your Gemini API key to .env');
    console.error('');
    throw new Error('GEMINI_API_KEY is required for E2E tests');
  }
});
