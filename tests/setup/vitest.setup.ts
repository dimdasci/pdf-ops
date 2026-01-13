import { beforeAll } from 'vitest';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables from .env file
config({ path: path.resolve(__dirname, '../../.env') });

beforeAll(() => {
  // Determine which provider to use (default: gemini)
  const provider = process.env.PROVIDER?.toLowerCase() || 'gemini';

  // Validate API key for the selected provider
  if (provider === 'claude') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set.');
      console.error('E2E tests with Claude provider require a valid Anthropic API key.');
      console.error('');
      console.error('To fix this:');
      console.error('1. Add your Anthropic API key to .env');
      console.error('2. Set ANTHROPIC_API_KEY=your_key_here');
      console.error('');
      throw new Error('ANTHROPIC_API_KEY is required for Claude provider');
    }
  } else {
    if (!process.env.GEMINI_API_KEY) {
      console.error('ERROR: GEMINI_API_KEY environment variable is not set.');
      console.error('E2E tests with Gemini provider require a valid Gemini API key.');
      console.error('');
      console.error('To fix this:');
      console.error('1. Copy .env.example to .env');
      console.error('2. Add your Gemini API key to .env');
      console.error('');
      throw new Error('GEMINI_API_KEY is required for Gemini provider');
    }
  }

  console.log(`\n🔧 Test setup complete. Using ${provider.toUpperCase()} provider.\n`);
});
