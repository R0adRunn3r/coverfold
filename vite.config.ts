/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { offline } from './offline-plugin.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// BASE_PATH lets the same build run locally ("/") or on GitHub Pages ("/<repo>/").
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  // offline(): service worker so the built app also works without internet (PWA).
  plugins: [react(), tailwindcss(), offline()],
  worker: { format: 'es' },
  // onnxruntime-web finds its .wasm next to itself (new URL(..., import.meta.url)), so it is not pre-bundled in dev.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
