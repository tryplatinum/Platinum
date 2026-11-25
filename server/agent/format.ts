// Turns a brief or a brainstorm into the counselor's reply, so the agent does
// not spend another model call restating what the tool already returned.

const clip = (text: string, max = 140) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function lines(title: string, items: unknown): string {
  if (!Array.isArray(items)) return ''
  const body = items
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 5)
    .map((item) => `- ${clip(item)}`)
  return body.length ? `**${title}**\n${body.join('\n')}` : ''
}

export function formatBrief(data: unknown): string {
  const row = data && typeof data === 'object' ? (data as { meetingTitle?: unknown; meetingDate?: unknown; brief?: unknown }) : {}
  const brief = row.brief && typeof row.brief === 'object' ? (row.brief as { headline?: unknown; agenda?: unknown; questions?: unknown }) : {}
  const title = typeof row.meetingTitle === 'string' ? row.meetingTitle : 'Meeting'
  const date = typeof row.meetingDate === 'string' ? row.meetingDate : ''
  const headline = typeof brief.headline === 'string' ? brief.headline.trim() : ''
  const agenda = Array.isArray(brief.agenda)
    ? brief.agenda
        .flatMap((item, index) => {
          if (!item || typeof item !== 'object') return []
          const topic = 'topic' in item && typeof item.topic === 'string' ? item.topic.trim() : ''
          const why = 'why' in item && typeof item.why === 'string' ? item.why.trim() : ''
          if (!topic && !why) return []
          return [`${index + 1}. **${topic || 'Topic'}.** ${why}`.trim()]
        })
        .join('\n')
    : ''
  const questions = Array.isArray(brief.questions)
    ? brief.questions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => `- ${item.trim()}`).join('\n')
    : ''
  return [
    `**${title}${date ? `, ${date}` : ''}**`,
    headline,
    agenda ? `**Agenda**\n${agenda}` : '',
    questions ? `**Questions**\n${questions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function formatBrainstorm(data: unknown): string {
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return [
    lines('Questions to ask', row.questions_to_ask),
    lines('Angles to explore', row.angles_to_explore),
    lines('Gaps in the story', row.gaps_in_story),
    lines('Materials to gather', row.materials_to_gather),
  ]
    .filter(Boolean)
    .join('\n\n')
}

const LANGUAGE: Record<string, string> = { en: 'English', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese' }
const CHANNEL: Record<string, string> = { text: 'text', email: 'email', line: 'LINE message', wechat: 'WeChat message' }

/** The confirmation after a drafted message: what, to whom, on which channel, in which language. */
export function formatDraftConfirmation(data: unknown): string {
  const row = data && typeof data === 'object' ? (data as { toName?: unknown; channel?: unknown; language?: unknown }) : {}
  if (typeof row.toName !== 'string' || typeof row.channel !== 'string' || typeof row.language !== 'string') return ''
  const channel = CHANNEL[row.channel] ?? row.channel
  const language = LANGUAGE[row.language] ?? row.language
  return `I drafted ${/^[aeiou]/i.test(channel) ? 'an' : 'a'} ${channel} to ${row.toName} in ${language}. Review it in Approvals.`
}

/** The reply for a tool whose output is the whole answer. Empty when this tool is not one of those. */
export function formatAnswer(name: string, data: unknown): string {
  if (name === 'prepare_meeting_brief') return formatBrief(data)
  if (name === 'essay_brainstorm') return formatBrainstorm(data)
  if (name === 'propose_message' || name === 'propose_parent_update') return formatDraftConfirmation(data)
  return ''
}
