import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Static single-page app served from the site root. Deep links such as
// /app/students/s-kevin rely on the host falling back to index.html:
// see public/_redirects (Netlify, Cloudflare Pages) and vercel.json.
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
