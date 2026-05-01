import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  root: __dirname,
  publicDir: false,
  build: {
    // Phase 2.5: outputs to ../public; legacy frontend lives in ../public/legacy.
    // Vite will not delete public/legacy because emptyOutDir is false.
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    sourcemap: false,
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@web': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '../src/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8002', ws: true },
      '/api': 'http://localhost:8002',
      '/sw.js': 'http://localhost:8002',
      '/favicon.ico': 'http://localhost:8002',
    },
  },
});
