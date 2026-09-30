/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The local API (server/index.ts); npm run dev starts both.
  // Reachable over Tailscale too (MagicDNS names end .ts.net).
  server: { port: 5180, strictPort: true, allowedHosts: ['.ts.net'], proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 5181}` } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
