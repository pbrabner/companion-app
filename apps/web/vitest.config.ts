/**
 * Vitest configuration for the Companion web app.
 * Manual @/* alias mirrors tsconfig.json paths so tests import like the app.
 * @module vitest.config
 */

import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // Deduplicate React — prevents "Invalid hook call" when design-system has
      // its own nested .pnpm/react@19.2.6 copy alongside apps/web react@19.2.5.
      // Maps any import of react/* from within src/design-system/... to the outer copy.
      {
        find: /^react$/,
        replacement: path.resolve(__dirname, 'node_modules/react'),
      },
      {
        find: /^react-dom$/,
        replacement: path.resolve(__dirname, 'node_modules/react-dom'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Inline design-system nested packages so they share the same React instance.
    // Without this, pnpm's nested node_modules resolve react@19.2.6 separately
    // from apps/web's react@19.2.5, causing "Invalid hook call" in Radix components.
    server: {
      deps: {
        inline: [/@radix-ui\//],
      },
    },
  },
});