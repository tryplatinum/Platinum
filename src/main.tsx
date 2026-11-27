// The entry. It decides one thing: the landing page, or the app.
//
// A signed-out visitor at "/" gets the landing page, which is its own chunk and
// carries none of the workspace code (no store, no Supabase client, no router).
// Everyone else gets the app. Whether someone is signed in is read here from
// what Supabase Auth keeps in this browser, without loading Supabase; the app
// checks properly, and shows the landing page itself if that session turns out
// to be over (src/App.tsx).

import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/manrope/wght.css'
import './index.css'
import { startTheme } from './theme'

startTheme()

function mayBeSignedIn(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) if (/^sb-.+-auth-token(\.\d+)?$/.test(localStorage.key(i) ?? '')) return true
  } catch {
    // Storage is blocked: nobody can be signed in.
  }
  return false
}

// A link from an email (confirm address, reset password) arrives with its tokens in the fragment: that is the app's to read.
const forApp = window.location.pathname !== '/' || mayBeSignedIn() || /access_token|error_description|type=/.test(window.location.hash)
void (forApp ? import('./appMain') : import('./landing/entry'))
