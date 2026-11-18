import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the same build works from a web host subfolder
  // and from the Capacitor Android WebView.
  base: './',
  server: { port: 5273, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
