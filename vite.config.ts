import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { FAVICON, PRODUCT_NAME } from './src/brand'

// The app is a static single-page site plus its server functions: api/ai.ts
// (AI drafts), api/documents.ts (stored files), api/colleges.ts (the college
// directory and list drafts), api/google.ts (the Google connection and Drive),
// all for signed-in counselors, and api/student.ts (the student link).
// On Vercel those files deploy as functions. In `npm run dev` the plugin below
// mounts the very same files under /api/, so the checks they
// make are the ones production makes, and there is nothing else to run locally.
// (`vite preview` serves only the static build: no AI, no student link.)
//
// Deep links such as /app/students/s-kevin rely on the host falling back to
// index.html: see vercel.json and public/_redirects.

/** Server-side settings read from .env.local in dev. None of these reach the browser. */
const SERVER_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SORT_MODEL',
  'AI_REFUSAL_FALLBACK',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SEND_ALLOWLIST',
  'TRANSPORT',
  'TRANSPORT_EMAIL',
  'PUBLIC_APP_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_TOKEN_KEY',
  'GOOGLE_REDIRECT_URI',
  'GOOGLE_FAKE',
  'GOOGLE_FAKE_STATE',
  'GOOGLE_SYNC_BATCH',
]

const FUNCTIONS = ['ai', 'student', 'documents', 'colleges', 'dispatch', 'google']

function devApi(): Plugin {
  return {
    name: 'platinum-dev-api',
    apply: 'serve',
    configureServer(server) {
      // Tells the server code it is running under `npm run dev`. GOOGLE_FAKE=1 is refused without it.
      process.env.PLATINUM_DEV_SERVER = '1'
      for (const name of FUNCTIONS) server.middlewares.use(`/api/${name}`, async (req, res) => {
        try {
          const handlers = (await server.ssrLoadModule(`/api/${name}.ts`)) as Record<string, ((request: Request) => Response | Promise<Response>) | undefined>
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value)
          const method = req.method ?? 'GET'
          // The real host and the query string are kept: Google's redirect arrives as a GET with ?code=&state=,
          // and the address it came to must be the one registered with Google.
          const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
          const request = new Request(`http://${req.headers.host ?? 'localhost'}/api/${name}${query}`, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
          })
          const handler = handlers[method]
          const response = handler ? await handler(request) : new Response('Method not allowed', { status: 405 })
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(response.body ? await response.text() : undefined)
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

/** index.html takes the product name and favicon from src/brand.ts, like everything else. */
function brandHtml(): Plugin {
  return {
    name: 'brand-html',
    transformIndexHtml: (html) => html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME).replaceAll('%FAVICON%', FAVICON),
  }
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The invented Google Drive is for `npm run dev` only. A build, or anything on Vercel, refuses to start with it.
  if ((env.GOOGLE_FAKE ?? process.env.GOOGLE_FAKE) === '1' && (command !== 'serve' || process.env.VERCEL)) {
    throw new Error('GOOGLE_FAKE=1 is only for `npm run dev`. Remove it before building or deploying.')
  }
  for (const key of SERVER_ENV) if (env[key] && !process.env[key]) process.env[key] = env[key]
  return { plugins: [react(), tailwindcss(), devApi(), brandHtml()] }
})
