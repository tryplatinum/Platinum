import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The app is a static single-page site plus ONE server function, api/ai.ts.
// On Vercel that file deploys as a function. In `npm run dev` the plugin below
// mounts the same file at /api/ai, so there is nothing else to run locally.
// (`vite preview` serves only the static build: AI falls back to placeholders.)
//
// Deep links such as /app/students/s-kevin rely on the host falling back to
// index.html: see vercel.json and public/_redirects.

/** Server-side settings read from .env.local in dev. None of these reach the browser. */
const SERVER_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'PLATINUM_PASSCODE', 'AI_REFUSAL_FALLBACK']

function devApi(): Plugin {
  return {
    name: 'platinum-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/ai', async (req, res) => {
        try {
          const handlers = (await server.ssrLoadModule('/api/ai.ts')) as Record<string, ((request: Request) => Response | Promise<Response>) | undefined>
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value)
          const method = req.method ?? 'GET'
          const request = new Request('http://localhost/api/ai', {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
          })
          const handler = handlers[method]
          const response = handler ? await handler(request) : new Response('Method not allowed', { status: 405 })
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await response.text())
        } catch (error) {
          console.error('[dev api]', error)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: false, code: 'server', message: 'The local AI endpoint crashed. See the terminal.' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of SERVER_ENV) if (env[key] && !process.env[key]) process.env[key] = env[key]
  return { plugins: [react(), tailwindcss(), devApi()] }
})
