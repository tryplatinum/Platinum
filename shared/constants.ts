// Constants shared by the browser and the server function. No imports, so the
// browser can use this file without pulling in Zod.

export const AI_ENDPOINT = '/api/ai'
/** The student link endpoint and the header that carries the link's token. */
export const STUDENT_ENDPOINT = '/api/student'
export const STUDENT_TOKEN_HEADER = 'x-student-token'
/** Requests larger than this are rejected before anything is parsed. */
export const MAX_REQUEST_BYTES = 60_000
/** Cap on any pasted notes, transcript or essay. */
export const MAX_TEXT_CHARS = 24_000
