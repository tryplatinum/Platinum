// The early access form's one way out. THERE IS NOWHERE TO SEND A REQUEST YET.
//
// Until a destination exists this function sends nothing and stores nothing:
// no request, no table, no third-party form service, no email, nothing kept in
// the browser. It answers "not open", and the form says so in plain words. It
// must never be made to answer `sent: true` for something that was not sent.
//
// To wire it up: replace the body with the real call, and return
// `{ sent: true }` only after the destination has confirmed it.

export interface EarlyAccessRequest {
  name: string
  email: string
  practice: string
  counselors: 'Just me' | '2 to 5' | '6 to 10' | 'More than 10'
  usesToday: string
}

export type EarlyAccessResult = { sent: true } | { sent: false; reason: 'not_open' }

/** Problems with what was typed, by field. Empty when the request could be sent. */
export function checkEarlyAccess(request: EarlyAccessRequest): Partial<Record<keyof EarlyAccessRequest, string>> {
  const problems: Partial<Record<keyof EarlyAccessRequest, string>> = {}
  if (!request.name.trim()) problems.name = 'Enter your name.'
  if (!request.email.trim()) problems.email = 'Enter your work email.'
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(request.email.trim())) problems.email = 'That does not look like an email address. Check it for a missing @ or dot.'
  if (!request.practice.trim()) problems.practice = 'Enter the name of your practice.'
  return problems
}

export async function requestEarlyAccess(request: EarlyAccessRequest): Promise<EarlyAccessResult> {
  // Read, and deliberately dropped: nothing leaves the page.
  void request
  return { sent: false, reason: 'not_open' }
}
