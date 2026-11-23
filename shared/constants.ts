// Constants shared by the browser and the server function. No imports, so the
// browser can use this file without pulling in Zod.

export const AI_ENDPOINT = '/api/ai'
export const PASSCODE_HEADER = 'x-platinum-passcode'
/** Requests larger than this are rejected before anything is parsed. */
export const MAX_REQUEST_BYTES = 60_000
/** Cap on any pasted notes, transcript or essay. */
export const MAX_TEXT_CHARS = 24_000
