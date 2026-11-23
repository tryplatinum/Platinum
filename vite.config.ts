import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The app is a static single-page site plus two server functions: api/ai.ts
// (AI drafts, for signed-in counselors) and api/student.ts (the student link).
// On Vercel those files deploy as functions. In `npm run dev` the plugin below
// mounts the very same files at /api/ai and /api/student, so the checks they
// make are the ones production makes, and there is nothing else to run locally.
// (`vite preview` serves only the static build: no AI, no student link.)
//
// Deep links such as /app/students/s-kevin rely on the host falling back to
// index.html: see vercel.json and public/_redirects.

/** Server-side settings read from .env.local in dev. None of these reach the browser. */
const SERVER_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'AI_REFUSAL_FALLBACK', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

const FUNCTIONS = ['ai', 'student']

function devApi(): Plugin {
  return {
    name: 'platinum-dev-api',
    apply: 'serve',
    configureServer(server) {
      for (const name of FUNCTIONS) server.middlewares.use(`/api/${name}`, async (req, res) => {
        try {
          const handlers = (await server.ssrLoadModule(`/api/${name}.ts`)) as Record<string, ((request: Request) => Response | Promise<Response>) | undefined>
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value)
          const method = req.method ?? 'GET'
          const request = new Request(`http://localhost/api/${name}`, {
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
          res.end(JSON.stringify({ ok: false, code: 'server', message: 'The local server function crashed. See the terminal.' }))
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
