// A message to a parent, with a control to read it in the parent's language,
// in English, or side by side. Used for parent reports, parent updates from a
// meeting, and reminders.

import { useState } from 'react'
import { CHANNEL_LABEL, LANGUAGE_LABEL, LANGUAGE_NATIVE } from '../lib/language'
import type { Language, Parent } from '../types'
import { SectionLabel, SegmentedControl, cx, textareaClass } from './ui'

/** "To Zhang Wei · WeChat · Simplified Chinese" */
export const recipientLine = (parent: Parent) => `To ${parent.name} · ${CHANNEL_LABEL[parent.channel]} · ${LANGUAGE_LABEL[parent.language]}`

type View = 'local' | 'en' | 'both'

export function Bilingual({
  language,
  en,
  local,
  editable = false,
  onChangeEn,
  onChangeLocal,
  recipient = 'the parent',
}: {
  language: Language
  en: string
  local?: string
  editable?: boolean
  onChangeEn?: (value: string) => void
  onChangeLocal?: (value: string) => void
  /** First name or short label, for "What Zhang Wei will receive". */
  recipient?: string
}) {
  const hasLocal = language !== 'en' && local !== undefined
  const [view, setView] = useState<View>('both')
  const rows = Math.max(5, Math.ceil(en.length / 70) + en.split('\n').length)

  const pane = (label: string, value: string, onChange: ((v: string) => void) | undefined, lang: string, received: boolean) => (
    <div className="min-w-0">
      <SectionLabel className="mb-1.5">{label}</SectionLabel>
      {editable ? (
        <textarea lang={lang} aria-label={label} className={textareaClass} rows={rows} value={value} onChange={(e) => onChange?.(e.target.value)} />
      ) : (
        <p lang={lang} className={cx('whitespace-pre-wrap rounded-lg px-3 py-2.5 text-sm leading-relaxed text-ink', received ? 'bg-canvas' : 'border border-line')}>
          {value}
        </p>
      )}
    </div>
  )

  if (!hasLocal) return pane(`What ${recipient} will receive`, en, onChangeEn, 'en', true)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <SegmentedControl
          label="Language"
        value={view}
        onChange={setView}
        options={[
          { value: 'both', label: 'Side by side' },
          { value: 'local', label: LANGUAGE_NATIVE[language] },
          { value: 'en', label: 'English' },
        ]}
        />
      </div>
      <div className={cx('grid gap-4', view === 'both' && 'lg:grid-cols-2')}>
        {view !== 'en' && pane(`What ${recipient} will receive`, local!, onChangeLocal, language, true)}
        {view !== 'local' && pane('English, for your review', en, onChangeEn, 'en', false)}
      </div>
      {editable && (
        <p className="text-xs text-muted">
          {/* TODO: re-translate the other side when one side is edited. */}
          The two sides are edited separately. If you change one, change the other to match before you approve.
        </p>
      )}
    </div>
  )
}
