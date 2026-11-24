// A student's college list, on the Overview. A college is found in the
// directory by typing its name, which links the row and shows the directory's
// figures under it; a college that is not in the directory can still be added
// by name. Rows from before the directory are offered a match, and are linked
// only when the counselor says so.
//
// A new row has no plan or deadline until the counselor sets them here: both
// show as "Not set". The directory holds no deadlines.

import { useEffect, useState } from 'react'
import type { CollegeSummary } from '../../../../shared/colleges'
import { CollegeFigures, CollegePicker, DirectorySourceNote, collegePlace } from '../../../components/colleges'
import { Button, Card, CardHeader, Empty, LinkButton, SectionLabel, cx, inputBase } from '../../../components/ui'
import { openListDraft } from '../../../lib/collegeListDraft'
import { collegeIsPending, collegesFor, dueText } from '../../../lib/derive'
import { dismissMatch, matchDismissed, useDirectoryColleges, useSuggestedMatches, type DirectoryFigures } from '../../../services/colleges'
import { useData, useStore } from '../../../store/store'
import type { ApplicationPlan, CollegeApp, CollegeStatus, Student } from '../../../types'

const PLANS: ApplicationPlan[] = ['ED', 'ED2', 'EA', 'REA', 'RD', 'Rolling', 'UC']
const STATUSES: { value: CollegeStatus; label: string }[] = [
  { value: 'considering', label: 'Planning' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'admitted', label: 'Admitted' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'denied', label: 'Denied' },
]
const NOT_SET = ''

function PlanSelect({ value, onChange, label }: { value?: ApplicationPlan; onChange: (plan?: ApplicationPlan) => void; label?: string }) {
  return (
    <select aria-label={label} className={cx(inputBase, !value && 'text-muted')} value={value ?? NOT_SET} onChange={(e) => onChange((e.target.value || undefined) as ApplicationPlan | undefined)}>
      <option value={NOT_SET}>Not set</option>
      {PLANS.map((p) => (
        <option key={p}>{p}</option>
      ))}
    </select>
  )
}

/** A date that may be empty. Saved when the field is left, so typing a year is one change, not four. */
function DeadlineInput({ value, onCommit, label }: { value?: string; onCommit: (date?: string) => void; label: string }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  return <input type="date" aria-label={label} className={cx(inputBase, !text && 'text-muted')} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== (value ?? '') && onCommit(text || undefined)} />
}

export function CollegeList({ student }: { student: Student }) {
  const data = useData()
  const { addCollege } = useStore.getState()
  const colleges = collegesFor(data, student.id)
  const directory = useDirectoryColleges(colleges.flatMap((c) => (c.directoryUnitid === undefined ? [] : [c.directoryUnitid])))
  const suggested = useSuggestedMatches(colleges.filter((c) => c.directoryUnitid === undefined).map((c) => c.name))
  const anyLinked = colleges.some((c) => c.directoryUnitid !== undefined)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<CollegeSummary>()
  const [plan, setPlan] = useState<ApplicationPlan>()
  const [deadline, setDeadline] = useState('')
  const alreadyListed = picked !== undefined && colleges.some((c) => c.directoryUnitid === picked.unitid)
  // A draft list waiting for review. Only counselors see it.
  const draft = openListDraft(data, student.id)
  const draftLink = (
    <LinkButton to={`/app/students/${student.id}/list-draft`} variant={draft ? 'remind' : 'secondary'}>
      {draft ? 'Review the draft list' : 'Draft a list'}
    </LinkButton>
  )

  const close = () => {
    setAdding(false)
    setName('')
    setPicked(undefined)
    setPlan(undefined)
    setDeadline('')
  }

  return (
    <Card>
      <CardHeader size="section" className="px-5 py-4" title="College list" count={colleges.length || undefined}
        action={
          !adding && (
            <>
              {draftLink}
              <Button onClick={() => setAdding(true)}>Add college</Button>
            </>
          )
        }
      />
      {adding && (
        <form
          className="mx-5 mb-4 flex flex-col gap-3 rounded-lg bg-canvas p-4"
          onSubmit={(e) => {
            e.preventDefault()
            const title = picked?.name ?? name.trim()
            if (!title || alreadyListed) return
            // No plan or deadline is assumed: both stay "Not set" until the counselor chooses.
            addCollege({ studentId: student.id, name: title, plan, deadline: deadline || undefined, status: 'considering', fit: 'Target', directoryUnitid: picked?.unitid })
            close()
          }}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-[16rem] flex-1">
              <SectionLabel className="mb-1">College</SectionLabel>
              {picked ? (
                <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm">
                  <span>
                    <span className="font-semibold">{picked.name}</span>
                    {collegePlace(picked) && <span className="text-muted"> · {collegePlace(picked)}</span>}
                  </span>
                  <Button variant="quiet" className="-mr-2 shrink-0" onClick={() => setPicked(undefined)}>
                    Change
                  </Button>
                </div>
              ) : (
                <CollegePicker
                  label="College"
                  autoFocus
                  value={name}
                  onChange={setName}
                  onPick={(college) => {
                    setPicked(college)
                    setName(college.name)
                  }}
                />
              )}
            </div>
            <label>
              <SectionLabel className="mb-1">Plan</SectionLabel>
              <PlanSelect value={plan} onChange={setPlan} />
            </label>
            <label>
              <SectionLabel className="mb-1">Deadline</SectionLabel>
              <input type="date" className={cx(inputBase, !deadline && 'text-muted')} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
          </div>
          {picked && !alreadyListed && (
            <div className="rounded-lg border border-line bg-surface p-3">
              <CollegeFigures college={picked} />
            </div>
          )}
          {alreadyListed && (
            <p role="alert" className="text-[13px] text-bad">
              {picked?.name} is already on {student.firstName}’s list.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-prose text-[13px] text-muted">
              {picked
                ? 'Plan and deadline can be left as “Not set” and filled in later. The directory has no deadlines.'
                : 'Pick a college from the results to link it to the directory. “Add it anyway” keeps the name as you typed it, for a college the directory does not have.'}
            </p>
            <div className="flex gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button type="submit" variant={picked ? 'primary' : 'secondary'} disabled={picked ? alreadyListed : !name.trim()}>
                {picked ? 'Add' : 'Add it anyway'}
              </Button>
            </div>
          </div>
          <DirectorySourceNote />
        </form>
      )}
      {colleges.length === 0 ? (
        !adding && (
          <Empty title="No colleges on the list yet.">
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add college
            </Button>
          </Empty>
        )
      ) : (
        <>
          <div className="relative overflow-x-auto border-t border-line">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="w-[38%] px-5 py-3 font-semibold">College</th>
                  <th className="px-3 py-3 font-semibold">Plan</th>
                  <th className="px-3 py-3 font-semibold">Deadline</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  {/* The scroll container above is "relative" so this hidden label stays inside it. */}
                  <th className="py-3 pl-3 pr-5">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {colleges.map((c) => (
                  <CollegeRows key={c.id} college={c} directory={directory} suggestion={c.directoryUnitid === undefined ? suggested(c.name) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
          {anyLinked && <DirectorySourceNote className="border-t border-line px-5 py-3" />}
        </>
      )}
    </Card>
  )
}

/** One college: its row, and under it either the directory's figures or the offer to link it. */
function CollegeRows({ college: c, directory, suggestion }: { college: CollegeApp; directory: DirectoryFigures; suggestion?: CollegeSummary }) {
  const { updateCollege, removeCollege } = useStore.getState()
  const [finding, setFinding] = useState<string>()
  const linked = c.directoryUnitid === undefined ? undefined : directory.college(c.directoryUnitid)
  const offer = suggestion && !matchDismissed(c.id, suggestion.unitid) ? suggestion : undefined

  const link = (found: CollegeSummary) => {
    updateCollege(c.id, { directoryUnitid: found.unitid })
    setFinding(undefined)
  }
  const unlink = () => {
    // Do not offer the same match straight back.
    if (c.directoryUnitid !== undefined) dismissMatch(c.id, c.directoryUnitid)
    updateCollege(c.id, { directoryUnitid: undefined })
  }

  return (
    <>
      <tr className="border-t border-line">
        <td className="px-5 py-2.5">
          <span className="font-semibold">{c.name}</span>
          {c.note && <span className="block text-[13px] text-muted">{c.note}</span>}
          {c.fitReason && (
            <span className="block text-[13px] text-ink-soft">
              <span className="font-semibold">{c.fit}.</span> {c.fitReason}
            </span>
          )}
          {c.directoryUnitid === undefined && finding === undefined && !offer && (
            <button type="button" className="block text-[13px] font-semibold text-accent underline" aria-label={`Find ${c.name} in the directory`} onClick={() => setFinding(c.name)}>
              Find in the directory
            </button>
          )}
        </td>
        <td className="px-3 py-2.5">
          <PlanSelect label={`Plan for ${c.name}`} value={c.plan} onChange={(plan) => updateCollege(c.id, { plan })} />
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <DeadlineInput label={`Deadline for ${c.name}`} value={c.deadline} onCommit={(deadline) => updateCollege(c.id, { deadline })} />
          <span className="block text-[13px] text-muted">{c.deadline ? collegeIsPending(c) && dueText(c.deadline) : 'Not set'}</span>
        </td>
        <td className="px-3 py-2.5">
          <select aria-label={`Status of ${c.name}`} className={inputBase} value={c.status} onChange={(e) => updateCollege(c.id, { status: e.target.value as CollegeStatus })}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </td>
        <td className="py-2.5 pl-3 pr-5 text-right">
          <Button variant="quiet" aria-label={`Remove ${c.name}`} onClick={() => window.confirm(`Remove ${c.name} from the list?`) && removeCollege(c.id)}>
            Remove
          </Button>
        </td>
      </tr>
      {(c.directoryUnitid !== undefined || finding !== undefined || offer) && (
      <tr>
        <td colSpan={5} className="px-5 pb-3">
          {c.directoryUnitid !== undefined ? (
            <div className="flex flex-col gap-1.5 rounded-lg bg-canvas px-3 py-2.5">
              {linked ? (
                <CollegeFigures college={linked} />
              ) : (
                <p className="text-[13px] text-muted">{directory.missing(c.directoryUnitid) ? 'The directory has no record for this link.' : (directory.error ?? 'Loading figures…')}</p>
              )}
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                {linked && (
                  <span>
                    Linked to {linked.name}
                    {collegePlace(linked) && `, ${collegePlace(linked)}`}
                    {!linked.isActive && ' · no longer listed as operating'}
                  </span>
                )}
                <button type="button" className="font-semibold text-accent underline" aria-label={`Unlink ${c.name} from the directory`} onClick={unlink}>
                  Unlink
                </button>
              </p>
            </div>
          ) : finding !== undefined ? (
            <div className="flex flex-wrap items-start gap-2 rounded-lg bg-canvas p-3">
              <CollegePicker className="min-w-[16rem] flex-1" label={`Find ${c.name} in the directory`} autoFocus value={finding} onChange={setFinding} onPick={link} />
              <Button onClick={() => setFinding(undefined)}>Cancel</Button>
            </div>
          ) : offer ? (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-canvas py-1 pl-3 pr-1 text-[13px] text-ink-soft">
              <span>
                Possible match in the directory: <span className="font-semibold">{offer.name}</span>
                {collegePlace(offer) && `, ${collegePlace(offer)}`}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <Button variant="remind" aria-label={`Link ${c.name} to ${offer.name}`} onClick={() => link(offer)}>
                  Link
                </Button>
                <Button variant="quiet" aria-label={`${offer.name} is not ${c.name}`} onClick={() => dismissMatch(c.id, offer.unitid)}>
                  Not this one
                </Button>
                <Button variant="quiet" aria-label={`Search the directory for ${c.name}`} onClick={() => setFinding(c.name)}>
                  Search
                </Button>
              </span>
            </div>
          ) : null}
        </td>
      </tr>
      )}
    </>
  )
}
