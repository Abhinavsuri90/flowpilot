import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: { port: Number(process.env.PORT ?? 3000) },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({
      importProtection: {
        // Server code (database, sessions, model keys) must never reach the browser bundle.
        client: { files: ['**/*.server.*', '**/src/server/**'] },
      },
    }),
    nitro(),
    viteReact(),
  ],
})
