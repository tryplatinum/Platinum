// Mounts the landing page by itself, for a signed-out visitor at "/". Nothing
// of the workspace is loaded: no store, no Supabase client, no router.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Landing from './Landing'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
)
