// Lets code outside React (the store, the session) show a toast. ToastProvider
// in components/ui.tsx listens; screens keep using useToast().

export type Notice =
  | { kind: 'text'; message: string }
  | { kind: 'queue'; messageId: string; sendAfter: string }

type Listener = (notice: Notice) => void

const listeners = new Set<Listener>()

export function notify(message: string): void {
  listeners.forEach((listener) => listener({ kind: 'text', message }))
}

/** A 60-second undo toast for a message the database just queued. */
export function notifyQueued(messageId: string, sendAfter: string): void {
  listeners.forEach((listener) => listener({ kind: 'queue', messageId, sendAfter }))
}

export function onNotify(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
