// The store's actions for stored files and folders. They are part of the one
// store (store.ts spreads them in); they live here to keep that file readable.
//
// A stored file's row is changed by the server (sorting, filing) while the
// browser holds a copy, so none of these send a stored-file row through the
// store's ordinary save. Each asks the server (services/files.ts) and takes the
// row it answers with into memory with `absorb`: memory changes, nothing is
// written back. Folders are ordinary rows and are saved the ordinary way.

import { tinyPdf } from '../../shared/files'
import { documentFrom } from '../data/repo'
import { SAMPLE_FILES } from '../data/seed'
import { nowTimestamp, todayISO } from '../lib/dates'
import { isStoredFile } from '../lib/files'
import { notify } from '../lib/notify'
import { FileFailure, callDocuments, checkFile, uploadToStorage, type DocumentRow } from '../services/files'
import type { AppData, DocumentType, FolderSensitivity, ID, Student, StudentDocument } from '../types'

export interface FileActions {
  /**
   * Uploads one file: the server makes the row, the browser sends the bytes
   * straight to storage, the server checks what arrived. The file then waits
   * for a person (see suggestFile and fileDocument). Throws with a message to
   * show beside the file; nothing is left behind when it does.
   */
  uploadFile: (file: File, options?: { studentId?: ID; onProgress?: (fraction: number) => void }) => Promise<StudentDocument>
  /** Asks the AI where an uploaded file belongs. Resolves with the file as it now stands; never throws. */
  suggestFile: (docId: ID) => Promise<StudentDocument | undefined>
  /**
   * A person files a document: accepts the suggestion, chooses something else, or moves a filed one.
   * `hidden` is true when it went into a folder only the firm's owner can open, and so left this person's lists.
   */
  fileDocument: (docId: ID, where: { typeId: ID; title: string; studentId?: ID }) => Promise<{ hidden: boolean; folderName: string }>
  renameFile: (docId: ID, title: string) => Promise<void>
  /** A link to view or download the file, good for 60 seconds. Marks the file opened. */
  openFile: (docId: ID, mode: 'view' | 'download') => Promise<string>
  /** Removes the stored object and the row together. */
  deleteFile: (docId: ID) => Promise<void>
  /** Brings files that were being sorted up to date, and lets the server finish any it was cut off on. */
  refreshFiles: () => Promise<void>
  /** Uploads the sample caseload's invented PDFs, already filed. Makes no AI request. */
  addSampleFiles: (students: Student[]) => Promise<void>

  // Folders (the firm's owner only; the database refuses anyone else)
  addFolder: (folder: { name: string; description: string; sensitivity: FolderSensitivity }) => void
  updateFolder: (id: ID, patch: Partial<Pick<DocumentType, 'name' | 'description' | 'sensitivity'>>) => void
  /** Moves a folder one place up (-1) or down (1) in the firm's order. */
  moveFolder: (id: ID, by: -1 | 1) => void
  /** Archiving moves nothing: files keep their folder and show it as archived. */
  archiveFolder: (id: ID, archived: boolean) => void
}

interface Tools {
  get: () => { data: AppData; mode: 'firm' | 'student_link'; account: { status: string; role?: 'owner' | 'counselor' } }
  absorb: (fn: (data: AppData) => AppData) => void
  change: (fn: (data: AppData) => AppData) => void
}

/** A row the server answered with, taken into memory: replaced in place, or added at the front (newest first). */
const withRow = (row: DocumentRow, addIfMissing = false) => (data: AppData): AppData => {
  const doc = documentFrom(row)
  if (data.documents.some((d) => d.id === doc.id)) return { ...data, documents: data.documents.map((d) => (d.id === doc.id ? doc : d)) }
  // An answer about a file that has since been deleted here must not bring it back.
  return addIfMissing ? { ...data, documents: [doc, ...data.documents] } : data
}

const without = (ids: ID[]) => (data: AppData): AppData => (data.documents.some((d) => ids.includes(d.id)) ? { ...data, documents: data.documents.filter((d) => !ids.includes(d.id)) } : data)

interface Filed {
  document: DocumentRow | null
  hidden: boolean
  folderName: string
}

/**
 * Before a firm's caseload is cleared: asks the server to remove every stored
 * file, objects first. Clearing rows alone would leave the objects behind with
 * nothing pointing at them. Skipped only when there cannot be any (an owner
 * sees every file, and holds none).
 */
export async function clearStoredFiles(state: { data: AppData; account: { status: string; role?: 'owner' | 'counselor' } }): Promise<void> {
  const mayHoldUnseen = state.account.role !== 'owner'
  if (!state.data.documents.some(isStoredFile) && !mayHoldUnseen) return
  try {
    await callDocuments('delete', { firm: true }, 120_000)
  } catch (error) {
    // A deployment with no server functions has no stored files to remove.
    if (error instanceof FileFailure && error.status === 404) return
    throw error
  }
}

export function fileActions({ get, absorb, change }: Tools): FileActions {
  const folders = (data: AppData) => [...data.documentTypes].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  const actions: FileActions = {
    uploadFile: async (file, options = {}) => {
      const mime = checkFile(file)
      const row = await callDocuments<DocumentRow>('start', { filename: file.name, size: file.size, type: mime, studentId: options.studentId, today: todayISO() })
      absorb(withRow(row, true))
      try {
        await uploadToStorage(row.storage_path!, file, mime, options.onProgress ?? (() => {}))
      } catch (error) {
        // Nothing half-made is left: the row goes, with whatever part of the file arrived.
        await callDocuments('delete', { documentId: row.id }).catch(() => undefined)
        absorb(without([row.id]))
        throw error
      }
      try {
        const checked = await callDocuments<DocumentRow>('finish', { documentId: row.id }, 60_000)
        absorb(withRow(checked))
        return documentFrom(checked)
      } catch (error) {
        // A file that failed the check was removed by the server, row and object.
        absorb(without([row.id]))
        throw error
      }
    },

    suggestFile: async (docId) => {
      try {
        const row = await callDocuments<DocumentRow>('suggest', { documentId: docId }, 75_000)
        // The answer can arrive after a person has filed, renamed or deleted the file. Then it is ignored:
        // what they did stands, here as on the server.
        absorb((data) => (data.documents.find((d) => d.id === docId)?.fileStatus === 'sorting' ? withRow(row)(data) : data))
      } catch {
        // No suggestion: the pickers work without one, and the file is settled the next time documents load.
      }
      return get().data.documents.find((d) => d.id === docId)
    },

    fileDocument: async (docId, where) => {
      const filed = await callDocuments<Filed>('file', { documentId: docId, typeId: where.typeId, title: where.title, studentId: where.studentId })
      absorb(filed.document ? withRow(filed.document) : without([docId]))
      return { hidden: filed.hidden, folderName: filed.folderName }
    },

    renameFile: async (docId, title) => {
      absorb(withRow(await callDocuments<DocumentRow>('rename', { documentId: docId, title })))
    },

    openFile: async (docId, mode) => {
      const opened = await callDocuments<{ url: string; document: DocumentRow }>('open', { documentId: docId, mode })
      absorb(withRow(opened.document))
      return opened.url
    },

    deleteFile: async (docId) => {
      try {
        await callDocuments('delete', { documentId: docId })
      } catch (error) {
        // Already gone on the server: it should go here too.
        if (!(error instanceof FileFailure && error.status === 404)) throw error
      }
      absorb(without([docId]))
    },

    refreshFiles: async () => {
      const state = get()
      if (state.mode !== 'firm' || state.account.status !== 'ready') return
      const ids = state.data.documents.filter((d) => isStoredFile(d) && (d.fileStatus === 'sorting' || d.fileStatus === 'uploading')).map((d) => d.id)
      if (ids.length === 0) return
      try {
        const settled = await callDocuments<{ documents: DocumentRow[]; missing: ID[] }>('settle', { ids })
        absorb((data) => {
          const rows = new Map(settled.documents.map((r) => [r.id, r]))
          // Only what changed gets a new object, so an upload in progress on this screen is not disturbed.
          const changed = data.documents.some((d) => settled.missing.includes(d.id) || (rows.has(d.id) && rows.get(d.id)!.file_status !== d.fileStatus))
          if (!changed) return data
          return { ...data, documents: data.documents.filter((d) => !settled.missing.includes(d.id)).map((d) => (rows.has(d.id) && rows.get(d.id)!.file_status !== d.fileStatus ? documentFrom(rows.get(d.id)!) : d)) }
        })
      } catch {
        // A background refresh: the next one will try again.
      }
    },

    addSampleFiles: async (students) => {
      const state = get()
      try {
        for (const sample of SAMPLE_FILES) {
          const student = students.find((s) => s.firstName === sample.studentFirstName)
          const folder = state.data.documentTypes.find((f) => f.name === sample.folder && !f.archivedAt)
          if (!student || !folder) continue
          const lines = [`Student: ${student.firstName} ${student.lastName}`, ...sample.lines, '', 'Invented sample file. Not a real document.']
          const pdf = tinyPdf(sample.heading, lines)
          const file = new File([pdf.buffer as ArrayBuffer], sample.filename, { type: 'application/pdf' })
          const doc = await actions.uploadFile(file, { studentId: student.id })
          // Filed by hand, as a counselor would, so loading the sample never calls the model.
          await actions.fileDocument(doc.id, { typeId: folder.id, title: sample.title, studentId: student.id })
        }
      } catch (error) {
        notify(`The sample files were not all added. ${error instanceof Error ? error.message : ''}`.trim())
      }
    },

    addFolder: (folder) =>
      change((data) => {
        const name = folder.name.trim().slice(0, 80)
        if (!name || data.documentTypes.some((f) => f.name.toLowerCase() === name.toLowerCase())) return data
        const position = Math.max(0, ...data.documentTypes.map((f) => f.position)) + 1
        return { ...data, documentTypes: [...data.documentTypes, { id: crypto.randomUUID(), name, description: folder.description.trim().slice(0, 200), sensitivity: folder.sensitivity, position }] }
      }),

    updateFolder: (id, patch) =>
      change((data) => {
        const current = data.documentTypes.find((f) => f.id === id)
        if (!current) return data
        const name = (patch.name ?? current.name).trim().slice(0, 80)
        if (!name || data.documentTypes.some((f) => f.id !== id && f.name.toLowerCase() === name.toLowerCase())) return data
        const next = { ...current, ...patch, name, description: (patch.description ?? current.description).trim().slice(0, 200) }
        if (next.name === current.name && next.description === current.description && next.sensitivity === current.sensitivity) return data
        return { ...data, documentTypes: data.documentTypes.map((f) => (f.id === id ? next : f)) }
      }),

    moveFolder: (id, by) =>
      change((data) => {
        const order = folders(data)
        const from = order.findIndex((f) => f.id === id)
        const to = from + by
        if (from < 0 || to < 0 || to >= order.length) return data
        ;[order[from], order[to]] = [order[to], order[from]]
        // Positions are renumbered 1..n; only folders whose place changed are saved.
        const place = new Map(order.map((f, i) => [f.id, i + 1]))
        return { ...data, documentTypes: order.map((f) => (f.position === place.get(f.id) ? f : { ...f, position: place.get(f.id)! })) }
      }),

    archiveFolder: (id, archived) =>
      change((data) => ({ ...data, documentTypes: data.documentTypes.map((f) => (f.id === id && Boolean(f.archivedAt) !== archived ? { ...f, archivedAt: archived ? nowTimestamp() : undefined } : f)) })),
  }
  return actions
}
