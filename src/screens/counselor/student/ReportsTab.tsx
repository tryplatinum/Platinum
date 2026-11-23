// Parent progress reports for one family. Drafts wait at the top for the
// counselor's approval, with the parent's language beside the English and the
// fact lines the draft was built from. Sent reports are listed below.

import { useState } from 'react'
import { Bilingual, recipientLine } from '../../../components/Bilingual'
import { AiErrorNote, AiTag, ApprovalStamp, Button, Card, CardHeader, Empty, Pill, PlaceholderNote, SENT_NOTE, SectionLabel, Thinking, inputClass, useAi, useToast } from '../../../components/ui'
import { formatDate } from '../../../lib/dates'
import { findParent, nextMeeting } from '../../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../../lib/language'
import { parentReport } from '../../../services/ai'
import { useData, useStore } from '../../../store/store'
import type { ParentReport, ReportSettings, Student } from '../../../types'

const SCHEDULES: { value: ReportSettings['schedule']; label: string }[] = [
  { value: 'after_meetings', label: 'After each meeting' },
  { value: 'every_two_weeks', label: 'Every two weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'manual', label: 'Only when I ask' },
]

export default function ReportsTab({ student }: { student: Student }) {
  const data = useData()
  const { addReportDraft, updateStudent } = useStore.getState()
  const { busy, error, run } = useAi()
  const reports = data.reports.filter((r) => r.studentId === student.id)
  const drafts = reports.filter((r) => r.status === 'draft')
  const sent = reports.filter((r) => r.status === 'sent').sort((a, b) => (b.sentOn ?? '').localeCompare(a.sentOn ?? ''))
  const [showAll, setShowAll] = useState(false)
  const settings = student.reportSettings
  const recipients = student.parents.filter((p) => settings.recipientIds.includes(p.id))
  const [to, setTo] = useState(recipients[0]?.id ?? student.parents[0]?.id ?? '')
  const parent = findParent(student, to) ?? student.parents[0]
  const upcoming = nextMeeting(data, student.id)

  const draft = () =>
    run(async () => {
      if (!parent) return
      const result = await parentReport(data, student.id, parent.id)
      if (result) addReportDraft({ ...result, studentId: student.id, parentId: parent.id, language: parent.language, channel: parent.channel })
    })

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        {drafts.map((r) => (
          <DraftCard key={r.id} report={r} student={student} count={drafts.length} />
        ))}

        <Card>
          <CardHeader size="section" className="px-5 py-4" title="Sent" action={sent.length > 0 && <span className="text-[13px] text-muted">{sent.length} logged</span>} />
          {sent.length === 0 ? (
            <div className="border-t border-line">
              <Empty title={student.parents.length ? 'No reports have gone out for this family yet.' : 'Add a parent on the Overview tab first. Reports are drafted in their language for their preferred channel.'}>
                {parent && (
                  <Button variant="primary" onClick={draft} disabled={busy}>
                    Draft a report now
                  </Button>
                )}
              </Empty>
            </div>
          ) : (
            <ul>
              {(showAll ? sent : sent.slice(0, 5)).map((r) => (
                <SentRow key={r.id} report={r} student={student} />
              ))}
            </ul>
          )}
          {sent.length > 5 && (
            <div className="border-t border-line px-5 py-2">
              <Button variant="quiet" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show ${sent.length - 5} older ${sent.length - 5 === 1 ? 'report' : 'reports'}`}
              </Button>
            </div>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold">Report settings</h2>
          <label>
            <SectionLabel className="mb-1">Schedule</SectionLabel>
            <select className={inputClass} value={settings.schedule} onChange={(e) => updateStudent(student.id, { reportSettings: { ...settings, schedule: e.target.value as ReportSettings['schedule'] } })}>
              {SCHEDULES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <SectionLabel>Goes to</SectionLabel>
            {student.parents.length === 0 && <p className="mt-1 text-sm text-muted">No parents on record.</p>}
            {student.parents.map((p) => (
              <label key={p.id} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={settings.recipientIds.includes(p.id)}
                  onChange={(e) =>
                    updateStudent(student.id, {
                      reportSettings: { ...settings, recipientIds: e.target.checked ? [...settings.recipientIds, p.id] : settings.recipientIds.filter((x) => x !== p.id) },
                    })
                  }
                />
                <span>
                  {p.name}
                  <span className="block text-[13px] text-muted">
                    {CHANNEL_LABEL[p.channel]} · {LANGUAGE_LABEL[p.language]}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">v0 has no scheduler: the schedule records your intention, and updates after a meeting are drafted when you log it. Language and channel are set on each parent in the Overview tab.</p>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold">Next report</h2>
          <p className="text-sm text-ink-soft">
            {settings.schedule === 'after_meetings' && upcoming
              ? `An update will be drafted when you log the meeting on ${formatDate(upcoming.date)}.`
              : 'Draft a report from the current tasks and deadlines whenever you want one.'}
          </p>
          {student.parents.length > 1 && (
            <label>
              <SectionLabel className="mb-1">For</SectionLabel>
              <select className={inputClass} value={parent?.id} onChange={(e) => setTo(e.target.value)}>
                {student.parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.relationship})
                  </option>
                ))}
              </select>
            </label>
          )}
          <AiErrorNote message={error} />
          {busy ? (
            <Thinking label={`AI is drafting a report for ${parent?.name}…`} />
          ) : (
            <Button onClick={draft} disabled={!parent}>
              Draft a report now
            </Button>
          )}
        </Card>
      </div>
    </div>
  )
}

function DraftCard({ report, student, count }: { report: ParentReport; student: Student; count: number }) {
  const { updateReport, approveReport, discardReport } = useStore.getState()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const parent = findParent(student, report.parentId)
  if (!parent) return null
  return (
    <Card className="flex flex-col gap-4 border-accent-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel className="text-accent">Waiting for your approval · {count}</SectionLabel>
          <h2 className="mt-0.5 text-xl font-bold">{report.subject}</h2>
          <p className="text-[13px] text-muted">{recipientLine(parent)} · drafted from tasks and deadlines</p>
        </div>
        <AiTag source={report.source} />
      </div>
      <PlaceholderNote source={report.source} />
      <Bilingual
        language={report.language}
        en={report.bodyEn}
        local={report.bodyLocal}
        recipient={parent.name}
        editable={editing}
        onChangeEn={(bodyEn) => updateReport(report.id, { bodyEn })}
        onChangeLocal={(bodyLocal) => updateReport(report.id, { bodyLocal })}
      />
      {report.facts && report.facts.length > 0 && (
        <details className="rounded-lg border border-line">
          <summary className="flex min-h-11 items-center px-3 text-[13px] font-semibold">The {report.facts.length} facts this report was built from · computed by Platinum, not by the AI</summary>
          <ul className="grid gap-x-6 gap-y-1 border-t border-line p-3 text-[13px] sm:grid-cols-2">
            {report.facts.map((f) => (
              <li key={f}>• {f}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit'}</Button>
        <Button onClick={() => discardReport(report.id)}>Discard</Button>
        <Button
          variant="primary"
          onClick={() => {
            approveReport(report.id)
            toast(`Report to ${parent.name} approved. ${SENT_NOTE}`)
          }}
        >
          Approve and send
        </Button>
      </div>
    </Card>
  )
}

function SentRow({ report, student }: { report: ParentReport; student: Student }) {
  const [open, setOpen] = useState(false)
  const parent = findParent(student, report.parentId)
  const firstLine = report.bodyEn.split(/\n|(?<=[.!?])\s/).filter(Boolean)[1] ?? report.bodyEn.slice(0, 120)
  return (
    <li className="border-t border-line px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="w-16 shrink-0 text-sm font-semibold">{formatDate(report.sentOn ?? report.createdOn)}</div>
        <div className="min-w-[12rem] flex-1">
          <div className="text-sm font-semibold">{report.subject}</div>
          <div className="line-clamp-1 text-[13px] text-muted">{firstLine}</div>
        </div>
        <div className="text-[13px] text-muted">
          {parent?.name ?? 'Parent'} · {CHANNEL_LABEL[report.channel]} · {LANGUAGE_LABEL[report.language]}
        </div>
        <Pill tone="good">Sent</Pill>
        <Button variant="quiet" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide' : 'View'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <Bilingual language={report.language} en={report.bodyEn} local={report.bodyLocal} recipient={parent?.name} />
          <p className="text-xs text-muted">
            <ApprovalStamp approval={report.approval} /> Logged as sent. v0 does not deliver messages.
          </p>
        </div>
      )}
    </li>
  )
}
