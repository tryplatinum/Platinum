// Light and dark. By default the app follows the device and changes with it.
// A person can turn that off in "View and settings" and choose one; the choice
// is kept in this browser only, so it is theirs and not the firm's.
//
// The look itself is all in src/index.css: the dark values are the same tokens
// set again under [data-theme='dark'] on <html>. index.html sets that attribute
// before the first paint, with the same storage key, so there is no flash.

import { useSyncExternalStore } from 'react'

export type Appearance = 'auto' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

/** Also written in index.html. Change both together. */
const STORAGE_KEY = 'appearance'

const deviceDark = () => window.matchMedia('(prefers-color-scheme: dark)')

function stored(): Appearance {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'auto'
  } catch {
    // Storage can be blocked (private windows, strict settings). Following the device still works.
    return 'auto'
  }
}

let appearance: Appearance = stored()
const listeners = new Set<() => void>()

const deviceTheme = (): Theme => (deviceDark().matches ? 'dark' : 'light')
const resolve = (): Theme => (appearance === 'auto' ? deviceTheme() : appearance)

function apply(): void {
  document.documentElement.dataset.theme = resolve()
  for (const listener of listeners) listener()
}

/** Call once at start-up. Keeps following the device while the setting is on auto. */
export function startTheme(): void {
  apply()
  deviceDark().addEventListener('change', apply)
  // The choice made in another tab applies here too.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    appearance = stored()
    apply()
  })
}

export function setAppearance(next: Appearance): void {
  appearance = next
  try {
    if (next === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not saved: the choice lasts until the page is closed.
  }
  apply()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The setting, and the theme showing right now (what "auto" currently resolves to). */
export function useAppearance(): { appearance: Appearance; theme: Theme } {
  const value = useSyncExternalStore(subscribe, () => `${appearance}:${resolve()}`)
  const [setting, theme] = value.split(':') as [Appearance, Theme]
  return { appearance: setting, theme }
}
