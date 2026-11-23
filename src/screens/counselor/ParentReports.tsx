// Parent progress reports. The AI drafts a report for one parent in their
// language; the counselor edits and approves; only then does it "go out".
// ReportsPanel is also used inside the student page (Reports tab).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bilingual, ParentLine } from '../../components/Bilingual'
import {
  AiErrorNote,
  ApprovalNotice,
  ApprovalStamp,
  Button,
  Card,
  Empty,
  PageHeader,
  Pill,
  PlaceholderNote,
  SourceBadge,
  Thinking,
  cx,
  inputBase,
  useAi,
} from '../../components/ui'
import { formatDate } from '../../lib/dates'
import { findParent, findStudent, fullName } from '../../lib/derive'
import { CHANNEL_LABEL } from '../../lib/language'
import { parentReport } from '../../services/ai'
import { useData, useStore } from '../../store/store'
import type { ID, ParentReport } from '../../types'

export default function ParentReports() {
  return (
    <div>
      <PageHeader
        title="Parent reports"
        subtitle="Progress reports to each parent, in their language and on their channel. Drafted by AI, sent only when you approve."
      />
      <ReportsPanel />
    </div>
  )
}

export function ReportsPanel({ studentId }: { studentId?: ID }) {
  const data = useData()
  const addReportDraft = useStore((s) => s.addReportDraft)
  const { busy, error, run } = useAi()
  const [pickedStudent, setPickedStudent] = useState(studentId ?? data.students[0].id)
  const student = findStudent(data, studentId ?? pickedStudent)!
  const [pickedParent, setPickedParent] = useState<ID | undefined>(student.parents[0]?.id)
  const parent = findParent(student, pickedParent) ?? student.parents[0]

  const reports = data.reports
    .filter((r) => !studentId || r.studentId === studentId)
    .sort((a, b) => (a.status === b.status ? b.createdOn.localeCompare(a.createdOn) : a.status === 'draft' ? -1 : 1))

  const draft = () =>
    run(async () => {
      if (!parent) return
      const result = await parentReport(data, student.id, parent.id)
      if (result) addReportDraft({ ...result, studentId: student.id, parentId: parent.id, language: parent.language, channel: parent.channel })
    })

  return (
    <div className="space-y-4">
      <ApprovalNotice />
      <Card>
        <div className="flex flex-wrap items-end gap-3 px-4 py-4">
          {!studentId && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Student</span>
              <select
                className={cx(inputBase, 'w-auto')}
                value={student.id}
                onChange={(e) => {
                  setPickedStudent(e.target.value)
                  setPickedParent(findStudent(data, e.target.value)?.parents[0]?.id)
                }}
              >
                {data.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fullName(s)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Parent</span>
            <select className={cx(inputBase, 'w-auto')} value={parent?.id} onChange={(e) => setPickedParent(e.target.value)}>
              {student.parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.relationship})
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" onClick={draft} disabled={busy || !parent}>
            ✦ Draft a report
          </Button>
          {parent && (
            <div className="pb-2">
              <ParentLine parent={parent} />
            </div>
          )}
        </div>
        {busy && <Thinking label={`AI is drafting a report for ${parent?.name}…`} />}
        {error && (
          <div className="px-4 pb-4">
            <AiErrorNote message={error} />
          </div>
        )}
      </Card>

      {reports.length === 0 && (
        <Card>
          <Empty>No reports yet.</Empty>
        </Card>
      )}
      {reports.map((r) => (
        <ReportCard key={r.id} report={r} showStudent={!studentId} />
      ))}
    </div>
  )
}

export function ReportCard({ report, showStudent }: { report: ParentReport; showStudent?: boolean }) {
  const data = useData()
  const updateReport = useStore((s) => s.updateReport)
  const approveReport = useStore((s) => s.approveReport)
  const discardReport = useStore((s) => s.discardReport)
  const student = findStudent(data, report.studentId)
  const parent = student && findParent(student, report.parentId)
  const [open, setOpen] = useState(report.status === 'draft')
  if (!student || !parent) return null
  const isDraft = report.status === 'draft'

  return (
    <Card tone={isDraft ? 'ai' : undefined}>
      <button className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div>
          <p className="text-sm font-semibold text-ink">
            {showStudent && (
              <>
                <Link to={`/app/students/${student.id}?tab=reports`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                  {fullName(student)}
                </Link>
                {' · '}
              </>
            )}
            {report.subject}
          </p>
          <div className="mt-1">
            <ParentLine parent={parent} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDraft ? (
            <>
              <SourceBadge source={report.source} />
              <Pill tone="warn">Needs your approval</Pill>
            </>
          ) : (
            <Pill tone="good">
              ✓ Approved · sent {report.sentOn && formatDate(report.sentOn)} via {CHANNEL_LABEL[report.channel]}
            </Pill>
          )}
          <span className="text-faint">{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && (
        <div className="space-y-4 border-t border-line px-4 py-4">
          {isDraft && <PlaceholderNote source={report.source} />}
          {report.facts && report.facts.length > 0 && (
            <details open={isDraft} className="rounded-lg border border-line">
              <summary className="px-3 py-2 text-xs font-medium text-muted">
                The facts behind this report ({report.facts.length}) · computed by Platinum from the task list, not by the AI
              </summary>
              <ul className="grid gap-x-6 gap-y-1 border-t border-line px-3 py-2 text-xs text-ink sm:grid-cols-2">
                {report.facts.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
            </details>
          )}
          <Bilingual
            language={report.language}
            en={report.bodyEn}
            local={report.bodyLocal}
            editable={isDraft}
            onChangeEn={(bodyEn) => updateReport(report.id, { bodyEn })}
            onChangeLocal={(bodyLocal) => updateReport(report.id, { bodyLocal })}
          />
          {isDraft ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="approve" onClick={() => approveReport(report.id)}>
                Approve and send via {CHANNEL_LABEL[report.channel]}
              </Button>
              <Button variant="ghost" onClick={() => discardReport(report.id)}>
                Discard
              </Button>
              <span className="text-xs text-faint">Not sent yet. Demo: sending only writes to the log.</span>
            </div>
          ) : (
            <p className="text-xs text-faint">
              <ApprovalStamp approval={report.approval} /> Shown as sent. Nothing was really delivered: see the <Link to="/app/notifications" className="underline">log</Link>.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
