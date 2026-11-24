// "A file the counselor deleted in Platinum is not imported again unless they
// ask." When a stored copy of a Drive file is deleted, its Drive id is written
// to the working state of the student's linked folders that brought it in. The
// next sync leaves it alone. Kept apart from the sync itself so that
// documentSorting.ts (which deletes) can call it without importing the sync.

import type { SyncState } from '../../shared/google.js'
import type { Json } from '../../src/lib/database.types.js'
import { serviceClient, serviceConfigured } from '../supabase.js'

export async function rememberRemovedHere(firmId: string, removed: { student_id: string | null; drive_file_id: string | null }[]): Promise<void> {
  const fromDrive = removed.filter((r): r is { student_id: string; drive_file_id: string } => Boolean(r.student_id && r.drive_file_id))
  if (fromDrive.length === 0 || !serviceConfigured()) return
  const db = serviceClient()
  for (const studentId of new Set(fromDrive.map((r) => r.student_id))) {
    const ids = fromDrive.filter((r) => r.student_id === studentId).map((r) => r.drive_file_id)
    const { data, error } = await db.from('student_drive_folders').select('id, sync_state, missing_file_ids').eq('firm_id', firmId).eq('student_id', studentId)
    // A failure here costs at most a file coming back on the next sync; the delete itself has already happened.
    if (error) return console.error('[google] could not record a deleted Drive file:', error.message)
    for (const folder of data) {
      const state = (folder.sync_state ?? {}) as SyncState
      // Only a folder that brought the file in remembers it.
      const mine = ids.filter((id) => state.known?.includes(id))
      if (mine.length === 0) continue
      const removedHere = [...new Set([...(state.removedHere ?? []), ...mine])]
      const next: SyncState = { ...state, removedHere, queue: state.queue?.filter((q) => !mine.includes(q.id)) }
      await db
        .from('student_drive_folders')
        .update({ sync_state: next as unknown as Json, removed_here_count: removedHere.length, missing_file_ids: folder.missing_file_ids.filter((id) => !mine.includes(id)) })
        .eq('id', folder.id)
        .eq('firm_id', firmId)
    }
  }
}
