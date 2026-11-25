// Join the assistant's text blocks. A newline, never an empty string: otherwise
// "Approvals." and "Nothing" become "Approvals.Nothing". A period already glued
// to the next sentence is split the same way, including inside one block.

/** True when a sentence runs into the next word with no space, as in "Approvals.Nothing". */
export const hasGluedSentence = (text: string) => /[a-z]\.[A-Z]/.test(text)

export function joinAssistantText(parts: readonly string[]): string {
  const joined = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
  return joined.replace(/([a-z])\.([A-Z])/g, '$1.\n$2').trim()
}

const COUNSELOR_INTRO = /(?:(?:i['’]m|i am)\b[^.!?。！？]*\bcounselor\b|升学顾问|升學顧問)/i

/** Drop an opening that introduces the writer as the student's counselor. */
export function withoutCounselorIntro(body: string): string {
  const paragraphs = body.trim().split(/\n+/)
  const cleaned = paragraphs
    .map((paragraph) => {
      const sentences = paragraph.split(/(?<=[.!?。！？])\s*/)
      return sentences.filter((sentence, index) => index > 1 || !COUNSELOR_INTRO.test(sentence)).join('').trim()
    })
    .filter(Boolean)
  return cleaned.join('\n')
}

function peelTrailing(text: string, token: string): string {
  if (!token) return text
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(?:\\s|\\n)*${escaped}\\s*$`), '').trim()
}

/** Drop a "I'm the college counselor" opening and sign with the counselor's name. */
export function signMessage(body: string, counselorName: string, firmName: string): string {
  const name = counselorName.trim()
  const firm = firmName.trim()
  let text = withoutCounselorIntro(body)
  text = peelTrailing(peelTrailing(text, firm), name)
  text = peelTrailing(peelTrailing(text, name), firm)
  const sign = [name, firm].filter(Boolean).join('\n')
  return sign ? `${text}\n\n${sign}`.trim() : text
}
