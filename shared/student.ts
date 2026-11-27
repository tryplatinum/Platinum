// The contract for the student link endpoint, /api/student. Shared by the
// browser (types only) and the server function (validation).

import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** The three things a student can do from their link. Nothing else is accepted. */
export const STUDENT_WRITE = z.discriminatedUnion('action', [
  /** Mark a task done or not done, and/or leave a progress note. */
  z.object({
    action: z.literal('progress'),
    taskId: z.uuid(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    progressNote: z.string().max(2000).optional(),
    /** The student's local date, so "completed on" matches their calendar. */
    today: isoDate,
  }),
  /** Attach a link (a Google Doc, say) to a task. */
  z.object({
    action: z.literal('attach_link'),
    taskId: z.uuid(),
    name: z.string().min(1).max(200),
    url: z.url({ protocol: /^https?$/ }).max(2000),
    today: isoDate,
  }),
])

export type StudentWrite = z.infer<typeof STUDENT_WRITE>

/**
 * Adding a file from the link, in two steps. The file itself never passes
 * through the server function: start_upload returns a one-time upload token for
 * one exact path, and the browser sends the file straight to storage.
 */
export const STUDENT_UPLOAD = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start_upload'),
    filename: z.string().min(1).max(300),
    /** The size and type the browser reports. Both are checked again against the real file. */
    size: z.number().int().positive(),
    type: z.string().max(200),
    today: isoDate,
  }),
  z.object({ action: z.literal('finish_upload'), documentId: z.uuid() }),
])

export type StudentUpload = z.infer<typeof STUDENT_UPLOAD>

/** What start_upload answers with. */
export interface StudentUploadTicket {
  documentId: string
  path: string
  /** Good for one upload to that path. */
  token: string
}

/** Tokens are 32 random bytes in base64url: 43 characters. */
export const STUDENT_TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/**
 * Why a request made with a student sign-in was refused. Requests made with a
 * link token carry no code, as before. An app goes by the code, not the words.
 *
 *   unauthorized   the access token is missing, expired or not Supabase's: sign in again
 *   signin_off     a counselor turned the sign-in off, or the student is archived
 *   not_a_student  the person signed in has no student account
 */
export type StudentErrorCode = 'unauthorized' | 'signin_off' | 'not_a_student'
