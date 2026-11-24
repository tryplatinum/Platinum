// The subject line of an email the dispatcher sends. The outbox holds no
// subject of its own yet, so one is derived from the kind of message, in the
// message's language. Pure, so the offline tests can check every case.
//
// A proposal: when the outbox gains a real subject, the dispatcher should pass
// that instead and this becomes the fallback.

import type { QueueLanguage } from './outbox.js'

const SUBJECTS: Record<string, Record<QueueLanguage, string>> = {
  parent_report: { en: 'Progress update', 'zh-Hans': '近期进展', 'zh-Hant': '近期進展' },
  reminder_upcoming: { en: 'Reminder: due soon', 'zh-Hans': '提醒：即将到期', 'zh-Hant': '提醒：即將到期' },
  reminder_late: { en: 'Reminder: past due', 'zh-Hans': '提醒：已逾期', 'zh-Hant': '提醒：已逾期' },
  meeting_recap: { en: 'Notes from our meeting', 'zh-Hans': '会议纪要', 'zh-Hant': '會議紀要' },
  essay_feedback: { en: 'Feedback on your essay', 'zh-Hans': '文书反馈', 'zh-Hant': '文書回饋' },
  weekly_text: { en: 'This week', 'zh-Hans': '本周安排', 'zh-Hant': '本週安排' },
}

const FALLBACK: Record<QueueLanguage, string> = { en: 'A message from your counselor', 'zh-Hans': '来自升学顾问的消息', 'zh-Hant': '來自升學顧問的訊息' }

/** A short subject for a message of this kind, in this language. English when the language is not one we write in. */
export function emailSubject(kind: string, language: string): string {
  const lang: QueueLanguage = language === 'zh-Hans' || language === 'zh-Hant' ? language : 'en'
  return (Object.hasOwn(SUBJECTS, kind) ? SUBJECTS[kind] : FALLBACK)[lang]
}
