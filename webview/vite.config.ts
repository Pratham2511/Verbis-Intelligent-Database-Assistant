import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

// Vite config for VS Code webview — CSP-safe (no eval, no inline scripts).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  // Inline dynamic imports are forbidden by VS Code CSP — force single chunk
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
