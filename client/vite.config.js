import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // Imported lazily (after the game loads), so the dev server can't discover it on
    // startup; listing it avoids a mid-session re-optimise and reload.
    include: ['@colyseus/sdk'],
  },
})
