import path from 'node:path';
import process from 'node:process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Same port for the browser and `tauri dev`: tauri expects a fixed one (high number so it does not
// clash with other local Vite apps), TAURI_DEV_HOST is set when developing against a mobile device.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep Rust compiler output visible in `tauri dev`.
  clearScreen: false,
  server: {
    port: 47831,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 47832 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Relative base so desktop hosts can load the build from disk.
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks cache well across app releases.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('@tanstack')) return 'tanstack';
          if (id.includes('@radix-ui')) return 'radix';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Integration tests drive the whole app through userEvent; generous limits keep them stable on
    // loaded or 2-vCPU CI machines without changing what is asserted.
    testTimeout: 20_000,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
});
