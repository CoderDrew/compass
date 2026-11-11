/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` makes the build work under any GitHub Pages repo path
// (https://<user>.github.io/<repo>/) because the app uses hash routing.
export default defineConfig({
  plugins: [react()],
  base: './',
  // Single small app (~190 kB gzipped incl. Recharts); no need to split.
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
  },
});
