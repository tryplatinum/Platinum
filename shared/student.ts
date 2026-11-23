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

/** Tokens are 32 random bytes in base64url: 43 characters. */
export const STUDENT_TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
