// The contract between the browser and the one server function (api/ai.ts).
//
// The browser sends { feature, input }. `input` carries the facts, because
// there is no database: the student's record, open tasks, deadlines, today's
// date. The server returns that feature's draft, shaped by the output schema
// below. The browser imports only the TYPES from this file, so Zod is not in
// the client bundle.
//
// Rule for every schema here: facts (what is overdue, which deadline is near)
// are computed in our code and passed IN. The model writes around them. No
// output schema has a field where the model supplies such a fact on its own.

import { z } from 'zod'

import { MAX_TEXT_CHARS } from './constants.js'

export { MAX_REQUEST_BYTES, MAX_TEXT_CHARS } from './constants.js'

const text = (max = 400) => z.string().max(max)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// ── Facts the browser sends ─────────────────────────────────────────────────

const ParentFact = z.object({
  id: text(60),
  name: text(80),
  localName: text(20).optional(),
  /** How to address this parent in Chinese, e.g. 张先生. Computed by our code. */
  zhAddress: text(20).optional(),
  relationship: z.enum(['Mother', 'Father', 'Guardian']),
  language: z.enum(['en', 'zh-Hans', 'zh-Hant']),
  channel: z.enum(['email', 'wechat', 'line', 'text']),
})

const TaskFact = z.object({
  title: text(),
  ownerType: z.enum(['student', 'parent', 'counselor']),
  /** "Kevin", "Dad (Zhang Wei)", "Counselor". */
  owner: text(80),
  ownerParentId: text(60).optional(),
  dueDate: isoDate,
  /** Computed by our code. 0 when not late. */
  daysLate: z.number().int().min(0),
  status: z.enum(['todo', 'in_progress']),
  progressNote: text().optional(),
})

const CollegeFact = z.object({
  name: text(120),
  plan: text(12),
  deadline: isoDate,
  status: text(20),
  /** Computed by our code. Negative when the deadline has passed. */
  daysUntilDeadline: z.number().int(),
})

/**
 * A "thing to remember": a small personal detail the student mentioned, which
 * a counselor approved. Built by notesForDraft in src/lib/facts.ts.
 *
 * GUARDRAIL: only the two inputs that write TO THE STUDENT accept these
 * (weeklyText, and reminderDraft when the recipient is the student). No
 * parent-facing input has a field for them, unknown fields are dropped when a
 * request is parsed, and reminderDraft refuses them for a parent recipient.
 * Do not add this to StudentFacts, parentReport or draftFromMeeting.
 */
const NoteFact = z.object({
  /** A short handle for this request only ("n1"), which the model returns as usedNoteId. */
  id: text(8),
  text: text(300),
  /** When the event is, computed by our code: "Sat, Nov 28 (in 5 days)". Absent when the note has no date. */
  when: text(60).optional(),
})
export type NoteFact = z.infer<typeof NoteFact>

/** Everything about one student that a feature may need. Built by src/lib/facts.ts. */
export const StudentFacts = z.object({
  today: isoDate,
  counselorFirstName: text(40),
  student: z.object({
    firstName: text(40),
    localGivenName: text(20).optional(),
    yearLabel: text(40),
    gradYear: z.number().int(),
    gpa: z.number(),
    sat: z.number().optional(),
    act: z.number().optional(),
    toefl: z.number().optional(),
    majors: z.array(text(80)).max(10),
    interests: z.array(text(80)).max(20),
    activities: z.array(z.object({ name: text(120), role: text(120), detail: text().optional() })).max(30),
  }),
  parents: z.array(ParentFact).max(4),
  openTasks: z.array(TaskFact).max(60),
  recentlyDone: z.array(z.object({ title: text(), completedOn: isoDate })).max(30),
  colleges: z.array(CollegeFact).max(40),
  nextMeeting: z.object({ title: text(), date: isoDate }).optional(),
  lastMeeting: z.object({ title: text(), date: isoDate }).optional(),
})
export type StudentFacts = z.infer<typeof StudentFacts>

// ── Inputs, one per feature ─────────────────────────────────────────────────

export const INPUTS = {
  draftFromMeeting: z.object({
    facts: StudentFacts,
    meeting: z.object({ title: text(), date: isoDate }),
    /** The counselor's notes or a transcript of the meeting. */
    source: z.string().min(20).max(MAX_TEXT_CHARS),
  }),
  readNotes: z.object({
    facts: StudentFacts,
    notes: z.string().min(10).max(MAX_TEXT_CHARS),
  }),
  preMeetingBrief: z.object({
    facts: StudentFacts,
    meeting: z.object({ title: text(), date: isoDate }),
    /** All computed by our code and shown to the counselor beside the brief. */
    computed: z.object({
      changesSinceLastMeeting: z.array(text()).max(60),
      overdue: z.array(text()).max(60),
      deadlinesNext14Days: z.array(text()).max(60),
      waitingOnCounselor: z.array(text()).max(30),
    }),
    /** The counselor's private notes. Only this feature receives them, because only the counselor reads the brief. */
    counselorNotes: text(4000).optional(),
    lastRecap: text(4000).optional(),
  }),
  parentReport: z.object({
    facts: StudentFacts,
    parentId: text(60),
    /** Fact lines computed by our code. The report may only state these. */
    reportFacts: z.array(text()).max(40),
  }),
  essayFeedback: z.object({
    studentFirstName: text(40),
    prompt: text(2000),
    essay: z.string().min(50).max(MAX_TEXT_CHARS),
  }),
  reminderDraft: z
    .object({
      facts: StudentFacts,
      /** Who the message goes to. For a parent, the id of that parent in the facts. */
      recipient: z.object({ kind: z.enum(['student', 'parent']), parentId: text(60).optional() }),
      channel: z.enum(['email', 'wechat', 'line', 'text']),
      language: z.enum(['en', 'zh-Hans', 'zh-Hant']),
      /** 'escalation' = telling a parent that their student's own task is late. */
      purpose: z.enum(['upcoming', 'late', 'escalation']),
      /** Computed by our code. These must appear in the message unchanged. */
      task: z.object({
        title: text(),
        owner: text(80),
        /** As it should be written in English, e.g. "Nov 14". */
        dueDate: text(40),
        /** As it should be written in Chinese, e.g. "11月14日". */
        dueDateZh: text(40),
        daysLate: z.number().int().min(0),
      }),
      /** Things to remember. Only for a reminder to the student. */
      personalNotes: z.array(NoteFact).max(3).optional(),
    })
    // GUARDRAIL: a message to a parent is never given a student's personal notes.
    .refine((input) => input.recipient.kind === 'student' || !input.personalNotes?.length, { path: ['personalNotes'], message: 'Personal notes are only for messages to the student.' }),
  weeklyText: z.object({
    today: isoDate,
    studentFirstName: text(60),
    counselorFirstName: text(40),
    language: z.enum(['en', 'zh-Hans', 'zh-Hant']),
    // Everything below is computed by our code (src/lib/reminders.ts) and must
    // appear in the text unchanged. The counselor's private notes are never sent.
    /** "Tue, Nov 26 at 4:00 PM". Absent when no meeting is coming up. */
    meeting: text(60).optional(),
    // `id` is a handle for this request ("t1") that the model returns as leadTaskId. category and
    // status help it judge which task is most urgent; they are not written into the text.
    late: z.array(z.object({ id: text(8).optional(), title: text(), due: text(40), late: text(40), category: text(20).optional(), status: text(20).optional() })).max(4),
    due: z.array(z.object({ id: text(8).optional(), title: text(), due: text(40), category: text(20).optional(), status: text(20).optional() })).max(4),
    /** The student's next application deadlines, computed by our code. For judging urgency only: never written into the text. */
    deadlines: z.array(z.object({ label: text(160), due: text(40), inDays: z.number().int() })).max(3).optional(),
    /** Tasks not listed. Written as "and N more". */
    more: z.number().int().min(0),
    /** The student's own link to their tasks. */
    link: text(300).optional(),
    /** Things to remember. The text may draw on at most one. */
    personalNotes: z.array(NoteFact).max(3).optional(),
    maxChars: z.number().int().min(100).max(1000),
  }),
} as const

export type Feature = keyof typeof INPUTS
export const FEATURES = Object.keys(INPUTS) as Feature[]
export type FeatureInput<F extends Feature> = z.infer<(typeof INPUTS)[F]>

// ── Outputs, one per feature ────────────────────────────────────────────────
// Structured outputs need every field present, so "optional" is spelled
// `.nullable()`, and there are no length or number constraints.

const ProposedTask = z.object({
  title: z.string(),
  /** Extra context from the notes, or null. */
  detail: z.string().nullable(),
  category: z.enum(['essay', 'application', 'testing', 'recommendation', 'financial', 'planning']),
  owner: z.enum(['student', 'parent', 'counselor']),
  /** The id of the parent from the facts when owner is "parent", otherwise null. */
  parentId: z.string().nullable(),
  /** YYYY-MM-DD. */
  dueDate: z.string(),
  /** "stated" when the notes give the date; "inferred" when the model chose one. Shown to the counselor. */
  dueDateBasis: z.enum(['stated', 'inferred']),
})
export type ProposedTask = z.infer<typeof ProposedTask>

const ParentMessage = z.object({
  parentId: z.string(),
  bodyEn: z.string(),
  /** In the parent's language, written natively. Null when the parent reads English. */
  bodyLocal: z.string().nullable(),
})

const ProfileSuggestion = z.object({
  kind: z.enum(['sat', 'act', 'toefl', 'gpa', 'add_activity', 'set_majors', 'add_interest']),
  /** Short label, e.g. "SAT score". */
  label: z.string(),
  from: z.string(),
  to: z.string(),
  /** The words from the notes that support this change. */
  evidence: z.string(),
  /** For sat, act, toefl, gpa. */
  numberValue: z.number().nullable(),
  /** For add_activity. */
  activity: z.object({ name: z.string(), role: z.string(), detail: z.string().nullable() }).nullable(),
  /** For set_majors (the full new list) and add_interest (one item). */
  listValue: z.array(z.string()).nullable(),
})
export type ProfileSuggestion = z.infer<typeof ProfileSuggestion>

export const OUTPUTS = {
  draftFromMeeting: z.object({
    /** The meeting at a glance: three short lists. */
    summary: z.object({ decided: z.array(z.string()), progress: z.array(z.string()), watch: z.array(z.string()) }),
    notes: z.array(z.string()),
    tasks: z.array(ProposedTask),
    recap: z.object({ summary: z.string(), nextSteps: z.array(z.string()) }),
    parentUpdates: z.array(ParentMessage),
    profileChanges: z.array(ProfileSuggestion),
    /** Up to three personal details the student mentioned. Reviewed by the counselor as "Things to remember". */
    personalNotes: z.array(
      z.object({
        /** One short sentence stating only what was said. */
        text: z.string(),
        /** The sentence from the notes that prompted it. */
        evidence: z.string(),
        /** YYYY-MM-DD when the notes give a date or day for it, otherwise null. */
        eventDate: z.string().nullable(),
      }),
    ),
  }),
  readNotes: z.object({
    summary: z.string(),
    tasks: z.array(ProposedTask),
  }),
  preMeetingBrief: z.object({
    /** Two or three sentences: where this student stands going into the meeting. */
    headline: z.string(),
    agenda: z.array(z.object({ topic: z.string(), why: z.string() })),
    /** Open questions worth asking the student. */
    questions: z.array(z.string()),
  }),
  parentReport: z.object({
    subject: z.string(),
    bodyEn: z.string(),
    bodyLocal: z.string().nullable(),
  }),
  // GUARDRAIL: this schema has observations, questions and locations. It has
  // no field for replacement text, so there is nowhere to put a rewrite. Do
  // not add one.
  essayFeedback: z.object({
    overall: z.string(),
    strengths: z.array(z.string()),
    notes: z.array(
      z.object({
        area: z.enum(['Structure', 'Clarity', 'Answers the prompt']),
        /** Where in the draft, e.g. "Paragraph 2" or "Final sentence". */
        location: z.string(),
        observation: z.string(),
        /** A question for the student to think about. */
        question: z.string(),
      }),
    ),
  }),
  reminderDraft: z.object({
    bodyEn: z.string(),
    /** In the recipient's language. Null when they read English. */
    bodyLocal: z.string().nullable(),
    /** The id of the personal note the message drew on, or null. Always null for a parent. */
    usedNoteId: z.string().nullable(),
  }),
  weeklyText: z.object({
    /** The whole text message, ready to send. */
    text: z.string(),
    /** The id of the personal note the text drew on, or null. */
    usedNoteId: z.string().nullable(),
    /**
     * The id of the task the text puts first as the most urgent, or null when fewer than two
     * tasks are listed. This is the model's judgment, and the only one in this feature: every
     * date and "days late" is still ours. The counselor is shown the choice and the reason.
     */
    leadTaskId: z.string().nullable(),
    /** One short sentence for the counselor on why that task comes first, or null. Not sent to the student. */
    leadReason: z.string().nullable(),
  }),
} as const

export type FeatureOutput<F extends Feature> = z.infer<(typeof OUTPUTS)[F]>

// ── Response envelope ───────────────────────────────────────────────────────

export type AiErrorCode =
  | 'no_key' // ANTHROPIC_API_KEY is not set on the server
  | 'not_configured' // the server has no Supabase settings, so it cannot check who is asking
  | 'unauthorized' // no valid session
  | 'no_firm' // signed in, but not a member of any firm
  | 'rate_limited'
  | 'too_large'
  | 'bad_request'
  | 'refusal' // the model declined
  | 'max_tokens' // the draft was cut off
  | 'upstream' // the Claude API returned an error
  | 'server'

export type AiResponse<F extends Feature> =
  | { ok: true; feature: F; draft: FeatureOutput<F>; model: string }
  | { ok: false; code: AiErrorCode; message: string }

/** GET /api/ai. Lets the browser show whether real drafts are available. */
export interface AiStatus {
  ok: true
  hasKey: boolean
  /** The server can verify sign-ins. */
  hasAuth: boolean
  model: string
}
