/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const serve = (port: number) => ({ host: '127.0.0.1', port, strictPort: true, allowedHosts: ['.ts.net', '.olly.live'], proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 5181}` } })

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The local API (server/index.ts); npm run dev starts both.
  // Reachable over Tailscale too (MagicDNS names end .ts.net), and the live
  // copy (scripts/live.sh, `vite preview`) as duel.olly.live. 127.0.0.1, not
  // localhost, which can resolve to ::1 only, where `tailscale serve` won't look.
  server: serve(5180),
  preview: serve(Number(process.env.WEB_PORT ?? 4173)),
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
