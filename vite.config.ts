import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Important for Electron to find assets
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // PDF.js is the largest dependency (~1MB)
            if (id.includes('pdfjs-dist')) {
              return 'vendor-pdf'
            }
            // LLM SDKs
            if (id.includes('@google/generative-ai') || id.includes('@anthropic-ai/sdk')) {
              return 'vendor-llm'
            }
            // React ecosystem
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'vendor-react'
            }
            // Effect.ts ecosystem
            if (id.includes('effect') || id.includes('@effect/')) {
              return 'vendor-effect'
            }
          }
          // Let remaining code stay in main chunk
          return undefined
        },
      },
    },
  },
})