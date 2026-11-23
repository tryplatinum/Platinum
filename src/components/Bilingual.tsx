// A message to a parent, with the English beside the parent's own language.
// Used for parent reports and for parent updates drafted from a meeting.

import { CHANNEL_LABEL, LANGUAGE_LABEL, LANGUAGE_NATIVE } from '../lib/language'
import type { Language, Parent } from '../types'
import { Pill, cx, inputClass } from './ui'

export function ParentLine({ parent }: { parent: Parent }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-medium text-ink">
        {parent.name}
        {parent.localName && <span className="ml-1 font-normal text-muted">{parent.localName}</span>}
      </span>
      <span className="text-xs text-muted">{parent.relationship}</span>
      <Pill tone="neutral">{LANGUAGE_LABEL[parent.language]}</Pill>
      <Pill tone="neutral">via {CHANNEL_LABEL[parent.channel]}</Pill>
    </span>
  )
}

export function Bilingual({
  language,
  en,
  local,
  editable = false,
  onChangeEn,
  onChangeLocal,
}: {
  language: Language
  en: string
  local?: string
  editable?: boolean
  onChangeEn?: (value: string) => void
  onChangeLocal?: (value: string) => void
}) {
  const hasLocal = language !== 'en' && local !== undefined
  const rows = Math.max(5, Math.ceil(en.length / 80) + en.split('\n').length)

  const pane = (label: string, sub: string, value: string, onChange?: (v: string) => void, lang?: string) => (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-muted">
        {label} <span className="font-normal text-faint">{sub}</span>
      </p>
      {editable ? (
        <textarea lang={lang} className={cx(inputClass, 'leading-relaxed')} rows={rows} value={value} onChange={(e) => onChange?.(e.target.value)} />
      ) : (
        <p lang={lang} className="whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-sm leading-relaxed text-ink">
          {value}
        </p>
      )}
    </div>
  )

  return (
    <div>
      <div className={cx('grid gap-4', hasLocal && 'lg:grid-cols-2')}>
        {pane('English', hasLocal ? 'for your review' : 'what the parent receives', en, onChangeEn, 'en')}
        {hasLocal && pane(LANGUAGE_NATIVE[language], 'what the parent receives', local!, onChangeLocal, language)}
      </div>
      {hasLocal && editable && (
        <p className="mt-2 text-xs text-faint">
          Demo: the two sides are edited separately. {/* TODO(real AI): re-translate when the English changes. */}
          In the product, changing the English updates the translation.
        </p>
      )}
    </div>
  )
}
