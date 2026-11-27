// A student's college list, on the Overview. A college is found in the
// directory by typing its name, which links the row and shows the directory's
// figures under it; a college that is not in the directory can still be added
// by name. Rows from before the directory are offered a match, and are linked
// only when the counselor says so.
//
// A new row has no plan or deadline until the counselor sets them here: both
// show as "Not set". The directory holds no deadlines.

import { useEffect, useRef, useState } from 'react'
import type { CollegeSummary } from '../../../../shared/colleges'
import { CollegeFigures, CollegePicker, DirectorySourceNote, FiguresLoading, collegePlace } from '../../../components/colleges'
import { MotionList, useRoomFor } from '../../../components/motion'
import { Button, Card, CardHeader, Empty, LinkButton, SectionLabel, cx, inputBase, useConfirm } from '../../../components/ui'
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
  const box = useRef<HTMLDivElement>(null)
  const wide = useRoomFor(box, 640)

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
            <div className="min-w-0 flex-1 basis-64">
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
          <Empty title="No colleges on the list yet. Add one by name, or have a list drafted from the directory.">
            <Button onClick={() => setAdding(true)}>
              Add college
            </Button>
          </Empty>
        )
      ) : (
        <>
          <div ref={box}>
            {wide ? (
              <table className="w-full border-collapse border-t border-line text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="w-[38%] px-5 py-3 font-semibold">
                      College
                    </th>
                    <th scope="col" className="px-2 py-3 font-semibold">
                      Plan
                    </th>
                    <th scope="col" className="px-2 py-3 font-semibold">
                      Deadline
                    </th>
                    <th scope="col" className="px-2 py-3 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="relative py-3 pl-2 pr-5">
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
            ) : (
              <MotionList itemClassName="border-t border-line">
                {colleges.map((c) => (
                  <CollegeRows key={c.id} stacked college={c} directory={directory} suggestion={c.directoryUnitid === undefined ? suggested(c.name) : undefined} />
                ))}
              </MotionList>
            )}
          </div>
          {anyLinked && <DirectorySourceNote className="border-t border-line px-5 py-3" />}
        </>
      )}
    </Card>
  )
}

/** One college: its row, and under it either the directory's figures or the offer to link it. */
function CollegeRows({ college: c, directory, suggestion, stacked }: { college: CollegeApp; directory: DirectoryFigures; suggestion?: CollegeSummary; /** A card instead of two table rows, where a table does not fit. */ stacked?: boolean }) {
  const { updateCollege, removeCollege } = useStore.getState()
  const confirm = useConfirm()
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

  const name = (
    <>
      <span className="text-sm font-semibold">{c.name}</span>
      {c.note && <span className="block text-[13px] text-muted">{c.note}</span>}
      {c.fitReason && (
        <span className="block text-[13px] text-ink-soft">
          <span className="font-semibold">{c.fit}.</span> {c.fitReason}
        </span>
      )}
      {c.directoryUnitid === undefined && finding === undefined && !offer && (
        <button type="button" className="flex min-h-11 items-center text-[13px] font-semibold text-accent underline" aria-label={`Find ${c.name} in the directory`} onClick={() => setFinding(c.name)}>
          Find in the directory
        </button>
      )}
    </>
  )
  const plan = <PlanSelect label={`Plan for ${c.name}`} value={c.plan} onChange={(next) => updateCollege(c.id, { plan: next })} />
  const deadline = (
    <>
      <DeadlineInput label={`Deadline for ${c.name}`} value={c.deadline} onCommit={(next) => updateCollege(c.id, { deadline: next })} />
      <span className="block text-[13px] text-muted">{c.deadline ? collegeIsPending(c) && dueText(c.deadline) : 'Not set'}</span>
    </>
  )
  const status = (
    <select aria-label={`Status of ${c.name}`} className={inputBase} value={c.status} onChange={(e) => updateCollege(c.id, { status: e.target.value as CollegeStatus })}>
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  )
  const remove = (
    <Button
      variant="quiet"
      aria-label={`Remove ${c.name}`}
      onClick={async () => {
        if (await confirm({ title: 'Remove college', body: `Remove ${c.name} from the list?`, action: 'Remove college' })) removeCollege(c.id)
      }}
    >
      Remove
    </Button>
  )
  const more =
    c.directoryUnitid !== undefined ? (
      <div className="flex flex-col gap-1.5 rounded-control bg-canvas px-3 py-2.5">
        {linked ? (
          <CollegeFigures college={linked} />
        ) : directory.missing(c.directoryUnitid) ? (
          <p className="text-[13px] text-muted">The directory has no record for this link.</p>
        ) : directory.error ? (
          <p role="alert" className="text-[13px] text-bad">
            {directory.error}
          </p>
        ) : (
          <FiguresLoading />
        )}
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {linked && (
            <span>
              Linked to {linked.name}
              {collegePlace(linked) && `, ${collegePlace(linked)}`}
              {!linked.isActive && ' · no longer listed as operating'}
            </span>
          )}
          <button type="button" className="min-h-11 font-semibold text-accent underline" aria-label={`Unlink ${c.name} from the directory`} onClick={unlink}>
            Unlink
          </button>
        </p>
      </div>
    ) : finding !== undefined ? (
      <div className="flex flex-wrap items-start gap-2 rounded-control bg-canvas p-3">
        <CollegePicker className="min-w-0 flex-1 basis-64" label={`Find ${c.name} in the directory`} autoFocus value={finding} onChange={setFinding} onPick={link} />
        <Button onClick={() => setFinding(undefined)}>Cancel</Button>
      </div>
    ) : offer ? (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control bg-canvas py-1 pl-3 pr-1 text-[13px] text-ink-soft">
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
    ) : undefined

  if (stacked) {
    return (
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">{name}</div>
          <span className="-my-2 -mr-3 shrink-0">{remove}</span>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            ['Plan', plan],
            ['Deadline', deadline],
            ['Status', status],
          ].map(([label, control]) => (
            <div key={label as string} className="min-w-0">
              <span aria-hidden className="mb-1 block text-xs font-semibold text-muted">
                {label}
              </span>
              {control}
            </div>
          ))}
        </div>
        {more}
      </div>
    )
  }

  return (
    <>
      <tr className="border-t border-line">
        <td className="px-5 py-2.5">{name}</td>
        <td className="px-2 py-2.5">{plan}</td>
        <td className="whitespace-nowrap px-2 py-2.5">{deadline}</td>
        <td className="px-2 py-2.5">{status}</td>
        <td className="py-2.5 pl-2 pr-3 text-right">{remove}</td>
      </tr>
      {more && (
        <tr>
          <td colSpan={5} className="px-5 pb-3">
            {more}
          </td>
        </tr>
      )}
    </>
  )
}
