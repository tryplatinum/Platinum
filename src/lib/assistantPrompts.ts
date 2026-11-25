// What the empty assistant panel suggests, by the page it is opened on. These
// are fixed sentences: nothing is asked of a model to make them, and choosing
// one only puts it in the box.

const GENERAL = ['Who needs attention this week?', "What's waiting for approval?", 'Who is behind?'] as const

const BY_PAGE: [prefix: string, prompts: readonly string[]][] = [
  ['/app/today', ['Who should I chase first today?', "What's waiting for approval?", 'Who am I meeting this week?', 'Who is behind?']],
  ['/app/students', ['Who is behind?', 'Who needs attention this week?', 'Who has a deadline in the next two weeks?']],
  ['/app/meetings', ['Who am I meeting this week?', 'Which meetings still need notes?', 'Who has no meeting scheduled?']],
  ['/app/messages', ['Which reminders are due?', 'Who has not heard from me this week?', "What's waiting for approval?"]],
  ['/app/documents', ['Which files are waiting to be filed?', 'Who is missing a document a task asks for?', 'Who is behind?']],
]

/** Three or four things to ask that fit the page. `firstName` is the student the page is about, if it is about one. */
export function assistantPrompts(pathname: string, firstName?: string): readonly string[] {
  if (firstName) return [`What's overdue for ${firstName}?`, `Prep me for my next meeting with ${firstName}`, `Draft a parent update for ${firstName}`, `What should ${firstName} work on this week?`]
  return BY_PAGE.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? GENERAL
}
