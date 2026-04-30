/**
 * Vitest configuration for the Companion web app.
 * Manual @/* alias mirrors tsconfig.json paths so tests import like the app.
 * @module vitest.config
 */

import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});