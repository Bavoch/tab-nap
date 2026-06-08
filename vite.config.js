import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    cors: {
      origin: [
        /chrome-extension:\/\//,
      ],
    },
    hmr: {
      port: 5173,
    },
  },
})
