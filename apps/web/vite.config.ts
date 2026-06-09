import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const WEB_PORT = Number(process.env.WEB_PORT ?? 5173)

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    strictPort: true,
  },
})
