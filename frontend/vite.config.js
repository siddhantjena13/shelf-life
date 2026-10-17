import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on the local network too, so an iPad on the same Wi-Fi/hotspot
    // can open http://<laptop-ip>:5173
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
