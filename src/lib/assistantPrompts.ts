// What the empty assistant panel suggests, by the page it is opened on. These
// are fixed sentences: nothing is asked of a model to make them, and choosing
// one only puts it in the box.
//
// Every suggestion is a question the assistant has a tool to answer. Each is
// listed with that tool, and scripts/test-assistant.ts checks that the tool
// exists and may be used in the thread the suggestion appears in, so a
// suggestion can never promise something the assistant cannot look up.

/** A suggestion, and the tool that answers it. */
export interface Suggestion {
  ask: string
  tool: string
}

const q = (ask: string, tool: string): Suggestion => ({ ask, tool })

const WHO_NEEDS_ATTENTION = q('Who needs attention this week?', 'list_students_needing_attention')
const WHAT_TO_REVIEW = q('What do I have to review?', 'list_pending_review')
const WHO_IS_BEHIND = q('Who is behind?', 'list_students_needing_attention')
const MEETINGS_THIS_WEEK = q('Who am I meeting this week?', 'list_meetings')

const GENERAL: readonly Suggestion[] = [WHO_NEEDS_ATTENTION, WHAT_TO_REVIEW, WHO_IS_BEHIND]

/** By page, for the general thread. */
export const SUGGESTIONS_BY_PAGE: [prefix: string, prompts: readonly Suggestion[]][] = [
  ['/app/today', [q('Who should I chase first today?', 'list_students_needing_attention'), WHAT_TO_REVIEW, MEETINGS_THIS_WEEK, WHO_IS_BEHIND]],
  ['/app/students', [WHO_IS_BEHIND, WHO_NEEDS_ATTENTION, q('Who has no meeting scheduled?', 'list_meetings')]],
  ['/app/meetings', [MEETINGS_THIS_WEEK, q('Which meetings still need notes?', 'list_meetings'), q('Who has no meeting scheduled?', 'list_meetings')]],
  ['/app/messages', [q('Which reminders are due?', 'list_reminders_due'), q('Which reminders already went out this week?', 'list_reminders_due'), WHAT_TO_REVIEW]],
  ['/app/documents', [q('Which files are waiting to be filed?', 'list_pending_review'), q('What files are waiting for me to check?', 'list_pending_review'), WHO_IS_BEHIND]],
  ['/app/templates', [q('Which templates do we have?', 'list_templates'), q('Which message templates need a due date?', 'list_templates'), WHAT_TO_REVIEW]],
  ['/app', [WHAT_TO_REVIEW, q('Which reminders are waiting for me to approve?', 'list_pending_review'), WHO_NEEDS_ATTENTION]],
]

/** For a student's own thread. `firstName` is the student the page is about. */
export const studentSuggestions = (firstName: string): readonly Suggestion[] => [
  q(`What's overdue for ${firstName}?`, 'list_tasks'),
  q(`Prep me for my next meeting with ${firstName}`, 'prepare_meeting_brief'),
  q(`Draft a parent update for ${firstName}`, 'propose_parent_update'),
  q(`Schedule my next meeting with ${firstName}`, 'propose_schedule_meeting'),
]

export const GENERAL_SUGGESTIONS = GENERAL

/** The suggestions for a page, with the tool behind each. */
export function suggestionsFor(pathname: string, firstName?: string): readonly Suggestion[] {
  if (firstName) return studentSuggestions(firstName)
  // The longest matching address wins, so "/app/messages" is not taken for "/app".
  return [...SUGGESTIONS_BY_PAGE].sort((a, b) => b[0].length - a[0].length).find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? GENERAL
}

/** Three or four things to ask that fit the page. `firstName` is the student the page is about, if it is about one. */
export const assistantPrompts = (pathname: string, firstName?: string): readonly string[] => suggestionsFor(pathname, firstName).map((s) => s.ask)
