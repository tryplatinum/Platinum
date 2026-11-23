// Labels and small helpers for languages and channels.

import type { Channel, Language, Parent, Student } from '../types'

export const LANGUAGE_LABEL: Record<Language, string> = {
  en: 'English',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
}

export const LANGUAGE_NATIVE: Record<Language, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Email',
  wechat: 'WeChat',
  line: 'LINE',
  text: 'Text',
}

/** Students get reminders by text in v0. */
export const STUDENT_CHANNEL: Channel = 'text'

/** "张先生" / "刘女士". Falls back to the romanised name. */
export function zhGreeting(parent: Parent): string {
  if (!parent.localName) return parent.name
  const surname = parent.localName[0]
  return surname + (parent.relationship === 'Father' ? '先生' : '女士')
}

/** The student's given name in Chinese ("凯文"), or their English first name. */
export function zhGiven(student: Student): string {
  return student.localName ? student.localName.slice(1) : student.firstName
}

/** "Mr. Zhang"-style greeting is not derivable from the data, so English messages use the full name. */
export function enGreeting(parent: Parent): string {
  return parent.name
}
