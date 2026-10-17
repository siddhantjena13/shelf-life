import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `npm run dev:phone` serves over HTTPS on your local network. Browsers only
// allow a live camera preview on HTTPS (or localhost), so this is how a phone
// on the same Wi-Fi gets the full camera experience. Accept the self-signed
// certificate warning once on the phone.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
}))
