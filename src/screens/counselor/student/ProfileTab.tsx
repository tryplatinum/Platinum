// A student's profile: the basics, academics, activities and the counselor's
// private notes. All editable. Changes the AI suggests after a meeting arrive
// here only once approved.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, CardHeader, Field, Pill, inputBase, inputClass, textareaClass, useToast } from '../../../components/ui'
import { CHANNEL_LABEL } from '../../../lib/language'
import { useStore } from '../../../store/store'
import type { Channel, Student } from '../../../types'

const toList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
const toNumber = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s))

export default function ProfileTab({ student }: { student: Student }) {
  const { updateStudent, archiveStudent } = useStore.getState()
  const toast = useToast()
  const navigate = useNavigate()
  const initial = {
    firstName: student.firstName,
    lastName: student.lastName,
    localName: student.localName ?? '',
    gradYear: String(student.gradYear),
    school: student.school,
    city: student.city,
    email: student.email ?? '',
    phone: student.phone ?? '',
    preferredChannel: student.preferredChannel ?? ('text' as Channel),
    weeklyText: student.weeklyText !== false,
    gpa: student.gpa?.toString() ?? '',
    gpaWeighted: student.gpaWeighted?.toString() ?? '',
    sat: student.tests.sat?.toString() ?? '',
    act: student.tests.act?.toString() ?? '',
    toefl: student.tests.toefl?.toString() ?? '',
    aps: student.tests.aps.map((a) => `${a.subject} ${a.score}`).join(', '),
    majors: student.majors.join(', '),
    interests: student.interests.join(', '),
  }
  const [f, setF] = useState(initial)
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const [notes, setNotes] = useState(student.counselorNotes)
  const [activity, setActivity] = useState({ name: '', role: '', detail: '' })

  const save = () => {
    updateStudent(student.id, {
      firstName: f.firstName.trim() || student.firstName,
      lastName: f.lastName.trim(),
      localName: f.localName.trim() || undefined,
      gradYear: Number(f.gradYear) || student.gradYear,
      school: f.school.trim(),
      city: f.city.trim(),
      email: f.email.trim() || undefined,
      phone: f.phone.trim() || undefined,
      preferredChannel: f.preferredChannel,
      weeklyText: f.weeklyText ? undefined : false,
      gpa: toNumber(f.gpa),
      gpaWeighted: toNumber(f.gpaWeighted),
      tests: {
        sat: toNumber(f.sat),
        act: toNumber(f.act),
        toefl: toNumber(f.toefl),
        // "Calculus BC 5, Physics 1 4": the last number in each item is the score.
        aps: toList(f.aps).flatMap((item) => {
          const m = item.match(/^(.*?)\s*([1-5])$/)
          return m ? [{ subject: m[1].trim(), score: Number(m[2]) }] : []
        }),
      },
      majors: toList(f.majors),
      interests: toList(f.interests),
    })
    toast('Profile saved.')
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form
        className="flex min-w-0 flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Card className="flex flex-col gap-4 p-5">
          <CardHeader size="section" title="Student" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <input className={inputClass} required value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} />
            </Field>
            <Field label="Last name">
              <input className={inputClass} value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} />
            </Field>
            <Field label="Name in Chinese">
              <input className={inputClass} value={f.localName} onChange={(e) => set({ localName: e.target.value })} />
            </Field>
            <Field label="Graduation year">
              <input className={inputClass} inputMode="numeric" value={f.gradYear} onChange={(e) => set({ gradYear: e.target.value })} />
            </Field>
            <Field label="School">
              <input className={inputClass} value={f.school} onChange={(e) => set({ school: e.target.value })} />
            </Field>
            <Field label="City">
              <input className={inputClass} value={f.city} onChange={(e) => set({ city: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className={inputClass} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className={inputClass} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            <Field label="Prefers to hear from you by">
              <select className={inputClass} value={f.preferredChannel} onChange={(e) => set({ preferredChannel: e.target.value as Channel })}>
                {(Object.entries(CHANNEL_LABEL) as [Channel, string][]).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="h-4 w-4" checked={f.weeklyText} onChange={(e) => set({ weeklyText: e.target.checked })} />
              Include in the weekly texts
              <span className="text-[13px] text-muted">(needs a phone number)</span>
            </label>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <CardHeader size="section" title="Academic profile" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Field label="GPA">
              <input className={inputClass} inputMode="decimal" value={f.gpa} onChange={(e) => set({ gpa: e.target.value })} />
            </Field>
            <Field label="Weighted GPA">
              <input className={inputClass} inputMode="decimal" value={f.gpaWeighted} onChange={(e) => set({ gpaWeighted: e.target.value })} />
            </Field>
            <Field label="SAT">
              <input className={inputClass} inputMode="numeric" value={f.sat} onChange={(e) => set({ sat: e.target.value })} placeholder="Not taken" />
            </Field>
            <Field label="ACT">
              <input className={inputClass} inputMode="numeric" value={f.act} onChange={(e) => set({ act: e.target.value })} placeholder="Not taken" />
            </Field>
            <Field label="TOEFL">
              <input className={inputClass} inputMode="numeric" value={f.toefl} onChange={(e) => set({ toefl: e.target.value })} placeholder="Not taken" />
            </Field>
          </div>
          <Field label="AP exams" hint="Subject then score, separated by commas: Calculus BC 5, Physics 1 4">
            <input className={inputClass} value={f.aps} onChange={(e) => set({ aps: e.target.value })} />
          </Field>
          <Field label="Intended majors" hint="Separate with commas">
            <input className={inputClass} value={f.majors} onChange={(e) => set({ majors: e.target.value })} />
          </Field>
          <Field label="Interests" hint="Separate with commas">
            <input className={inputClass} value={f.interests} onChange={(e) => set({ interests: e.target.value })} />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={!dirty}>
              Save profile
            </Button>
            {dirty && <span className="text-[13px] text-warn">You have unsaved changes.</span>}
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <CardHeader size="section" title="Activities" count={student.activities.length || undefined} />
          {student.activities.length === 0 && <p className="text-sm text-muted">No activities yet. Add what {student.firstName} does outside class.</p>}
          <ul>
            {student.activities.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
                <div className="text-sm">
                  <span className="font-semibold">{a.name}</span>
                  <span className="text-muted"> · {a.role}</span>
                  {a.detail && <p className="text-[13px] text-muted">{a.detail}</p>}
                </div>
                <Button variant="quiet" className="-my-1.5 shrink-0" aria-label={`Remove ${a.name}`} onClick={() => updateStudent(student.id, { activities: student.activities.filter((x) => x.id !== a.id) })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-canvas p-3">
            <input className={`${inputBase} min-w-[10rem] flex-1`} placeholder="Activity" aria-label="Activity" value={activity.name} onChange={(e) => setActivity({ ...activity, name: e.target.value })} />
            <input className={`${inputBase} min-w-[8rem] flex-1`} placeholder="Role" aria-label="Role" value={activity.role} onChange={(e) => setActivity({ ...activity, role: e.target.value })} />
            <input className={`${inputBase} min-w-[10rem] flex-[2]`} placeholder="Detail (optional)" aria-label="Detail" value={activity.detail} onChange={(e) => setActivity({ ...activity, detail: e.target.value })} />
            <Button
              disabled={!activity.name.trim()}
              onClick={() => {
                updateStudent(student.id, { activities: [...student.activities, { id: `act-${Date.now()}`, name: activity.name.trim(), role: activity.role.trim() || 'Member', detail: activity.detail.trim() || undefined }] })
                setActivity({ name: '', role: '', detail: '' })
              }}
            >
              Add activity
            </Button>
          </div>
        </Card>
      </form>

      <div className="flex min-w-0 flex-col gap-6">
        <Card className="flex flex-col gap-3 p-5">
          <CardHeader title="Your notes" action={<Pill>Private</Pill>} />
          <textarea className={textareaClass} rows={9} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Your private notes" placeholder={`How ${student.firstName} works best, what the family is like, what to remember.`} />
          <div className="flex items-center gap-3">
            <Button onClick={() => (updateStudent(student.id, { counselorNotes: notes }), toast('Notes saved.'))} disabled={notes === student.counselorNotes}>
              Save notes
            </Button>
          </div>
          <p className="text-xs text-muted">Never shown to the student or parents. The AI reads these only for your pre-meeting brief.</p>
        </Card>

        <Card className="flex flex-col items-start gap-3 p-5">
          <h2 className="text-base font-semibold">{student.archived ? 'Archived' : 'Archive this student'}</h2>
          <p className="text-sm text-ink-soft">Archiving removes {student.firstName} from every list and keeps all their history. You can restore them from the Students page.</p>
          <Button
            variant={student.archived ? 'secondary' : 'danger'}
            onClick={() => {
              archiveStudent(student.id, !student.archived)
              if (!student.archived) navigate('/app/students')
            }}
          >
            {student.archived ? 'Restore' : `Archive ${student.firstName}`}
          </Button>
        </Card>
      </div>
    </div>
  )
}
