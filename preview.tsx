// TEMPORARY screenshot harness. Not committed. Renders the app from the sample
// caseload with no sign-in and no database.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/manrope/wght.css'
import './src/index.css'
import App from './src/App'
import { ToastProvider } from './src/components/ui'
import { buildSeed } from './src/data/seed'
import { useStore } from './src/store/store'

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') ?? 'light'
const path = params.get('path') ?? '/app'
const seed = buildSeed()

if (path.startsWith('/s/')) {
  const student = seed.students[0]
  const data = { ...seed, students: [student] }
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/student')) return new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } })
    return real(input, init)
  }
} else {
  useStore.setState({ account: { status: params.get('account') === 'out' ? 'signed_out' : 'ready', userId: 'u', email: 'counselor@example.com', firmId: 'f', role: 'owner' } as never, load: 'ready', mode: 'firm', data: seed })
}
;(window as never as { seed: unknown }).seed = seed

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </MemoryRouter>
  </StrictMode>,
)
