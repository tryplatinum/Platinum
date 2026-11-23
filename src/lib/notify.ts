// Lets code outside React (the store, the session) show a toast. ToastProvider
// in components/ui.tsx listens; screens keep using useToast().

type Listener = (message: string) => void

const listeners = new Set<Listener>()

export function notify(message: string): void {
  listeners.forEach((listener) => listener(message))
}

export function onNotify(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
