// Derived facts about stored files and folders, so the student's Documents
// tab, the firm-wide Documents screen and the upload window all agree.
//
// A stored file is a document with a storagePath. Essays and the older
// name-or-link rows have none and are never treated as files to sort.

import { MIME } from '../../shared/files'
import type { AppData, DocumentType, ID, Student, StudentDocument } from '../types'
import { fullName } from './derive'

export const isStoredFile = (doc: StudentDocument) => Boolean(doc.storagePath)

export const fileTitle = (doc: StudentDocument) => doc.title ?? doc.name

/** The firm's folders in the firm's own order. */
export function foldersInOrder(data: AppData): DocumentType[] {
  return [...data.documentTypes].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

/** Folders that still take new files. */
export const openFolders = (data: AppData) => foldersInOrder(data).filter((f) => !f.archivedAt)

export const folderById = (data: AppData, id: ID | undefined) => data.documentTypes.find((f) => f.id === id)

const FOLDER_FOR_CATEGORY: Record<string, string> = { academic: 'Transcripts and grades', testing: 'Test scores', application: 'Applications', recommendation: 'Recommendations', financial: 'Financial aid' }

/** The folder a document shows under. An older row with no folder goes by its category, or else under the catch-all. */
export function folderOf(data: AppData, doc: StudentDocument): DocumentType | undefined {
  return folderById(data, doc.typeId) ?? data.documentTypes.find((f) => f.name === FOLDER_FOR_CATEGORY[doc.category]) ?? catchAllFolder(data)
}

/** The folder new files fall into when nothing better is known. */
export const catchAllFolder = (data: AppData) => openFolders(data).find((f) => f.name === 'Other') ?? openFolders(data).at(-1)

/** A student's upload the AI has not filed yet. Shown to the counselor as "Sorting…". */
export const isSorting = (doc: StudentDocument) => isStoredFile(doc) && doc.uploadedByKind === 'student_link' && doc.fileStatus === 'sorting'

/** Filed, but marked for a person to look at: the AI was not sure, failed, or sorting is switched off. */
export const needsCheck = (doc: StudentDocument) => isStoredFile(doc) && doc.fileStatus === 'filed' && Boolean(doc.needsCheck)

/** Filed and never opened by a counselor. */
export const isNewFile = (doc: StudentDocument) => isStoredFile(doc) && doc.fileStatus === 'filed' && !doc.openedAt

/** A counselor's upload that no person has filed yet. It belongs to no student's page until then. */
export const isWaiting = (doc: StudentDocument) => isStoredFile(doc) && doc.uploadedByKind === 'counselor' && (doc.fileStatus === 'sorting' || doc.fileStatus === 'suggested')

/**
 * What a student's Documents tab lists: older name-or-link rows, filed files,
 * and the student's own uploads still being sorted. Never essays, and never a
 * counselor's upload that is still waiting to be filed.
 */
export function studentFiles(data: AppData, studentId: ID): StudentDocument[] {
  return data.documents
    .filter((d) => d.studentId === studentId && d.kind !== 'essay' && (!isStoredFile(d) || d.fileStatus === 'filed' || isSorting(d)))
    .sort((a, b) => b.addedOn.localeCompare(a.addedOn))
}

const active = (data: AppData) => new Set(data.students.filter((s) => !s.archived).map((s) => s.id))

/** "Waiting for you": counselor uploads not yet filed, newest first. */
export const waitingFiles = (data: AppData) => data.documents.filter(isWaiting)

/** "Check these", across the firm's active students. */
export function filesToCheck(data: AppData): StudentDocument[] {
  const students = active(data)
  return data.documents.filter((d) => needsCheck(d) && students.has(d.studentId))
}

/** Everything new across the firm's active students, without the ones already listed to check. */
export function newFiles(data: AppData): StudentDocument[] {
  const students = active(data)
  return data.documents.filter((d) => (isNewFile(d) || isSorting(d)) && !needsCheck(d) && students.has(d.studentId))
}

/** Who added a file, in a word or two. */
export function uploadedBy(doc: StudentDocument, student: Student | undefined, me: ID | undefined): string {
  if (doc.uploadedByKind === 'student_link' || doc.addedBy === 'student') return student?.firstName ?? 'The student'
  if (doc.addedBy === 'parent') return 'Parent'
  if (isStoredFile(doc) && doc.uploadedByUser && doc.uploadedByUser !== me) return 'A colleague'
  return 'You'
}

/** "PDF", "Photo", "Word", "Excel": a short tag for the kind of file. */
export function fileKind(doc: Pick<StudentDocument, 'mimeType' | 'url' | 'name'>): string {
  switch (doc.mimeType) {
    case MIME.pdf:
      return 'PDF'
    case MIME.jpeg:
    case MIME.png:
    case MIME.heic:
      return 'Photo'
    case MIME.docx:
      return 'Word'
    case MIME.xlsx:
      return 'Excel'
    default:
      return doc.url ? 'Link' : 'Note'
  }
}

/** PDFs and ordinary images open in the preview panel. Everything else downloads. */
export const canPreview = (doc: StudentDocument) => doc.mimeType === MIME.pdf || doc.mimeType === MIME.jpeg || doc.mimeType === MIME.png

/** A file the same student already has with the same contents. */
export function duplicateOf(data: AppData, studentId: ID | undefined, hash: string | undefined, exceptId?: ID): StudentDocument | undefined {
  if (!studentId || !hash) return undefined
  return data.documents.find((d) => d.id !== exceptId && d.studentId === studentId && d.contentHash === hash && d.fileStatus !== 'uploading')
}

/** "Suggested: put this under Maya Chen, Test scores, as “SAT score report, Aug 2026”", in plain words. */
export function suggestionLine(data: AppData, doc: StudentDocument): string | undefined {
  const suggestion = doc.aiSuggestion
  const folder = folderById(data, suggestion?.typeId)
  if (!suggestion || !folder) return undefined
  const student = data.students.find((s) => s.id === doc.studentId)
  return `Suggested: put this under ${student ? `${fullName(student)}, ` : ''}${folder.name}, as “${suggestion.title}”`
}
