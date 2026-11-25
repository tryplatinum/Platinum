// Settings: the firm, its folders, the Google account, the counselor's phone,
// reminder rules, appearance, and the demo data controls. Links can point at a
// section by its id (/app/settings#reminder-rules).

import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FolderSettings } from '../../components/files/FolderSettings'
import { GoogleAccount } from '../../components/google/GoogleAccount'
import { YourPhone } from '../../components/phone/YourPhone'
import { Button, Card, CardHeader, CheckRow, Field, PageHeader, SegmentedControl, cx, inputBase, inputClass, useConfirm, usePageTitle, useToast } from '../../components/ui'
import { WEEKDAYS } from '../../lib/derive'
import { useData, useStore } from '../../store/store'
import { setAppearance, useAppearance } from '../../theme'
import type { ReminderMode } from '../../types'

export default function Settings() {
  const { hash } = useLocation()
  usePageTitle('Settings')
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [hash])
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex max-w-3xl flex-col gap-6">
        <Section id="firm">
          <FirmForm />
        </Section>
        <Section id="folders">
          <FolderSettings />
        </Section>
        {/* These two show nothing when the server is not set up for them. */}
        <Section id="google">
          <GoogleAccount />
        </Section>
        <Section id="phone">
          <YourPhone />
        </Section>
        <Section id="reminder-rules">
          <ReminderRules />
        </Section>
        <Section id="appearance">
          <AppearanceSetting />
        </Section>
        <Section id="demo-data">
          <DemoData />
        </Section>
      </div>
    </>
  )
}

/** A place a link can point at, clear of the bar at the top of the page. Takes no room when its section shows nothing. */
function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20 empty:hidden">
      {children}
    </div>
  )
}

// ── Firm ────────────────────────────────────────────────────────────────────

function FirmForm() {
  const firm = useData().firm
  const updateFirm = useStore((s) => s.updateFirm)
  const toast = useToast()
  const [name, setName] = useState(firm.name)
  const [counselor, setCounselor] = useState(firm.counselorName)
  const unchanged = name.trim() === firm.name && counselor.trim() === firm.counselorName
  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHeader size="section" title="Firm" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          const next = { name: name.trim() || firm.name, counselorName: counselor.trim() || firm.counselorName }
          updateFirm(next)
          setName(next.name)
          setCounselor(next.counselorName)
          toast('Saved.')
        }}
      >
        <Field label="Firm name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Your name" hint="Used to sign messages and to record who approved each draft.">
          <input className={inputClass} value={counselor} onChange={(e) => setCounselor(e.target.value)} />
        </Field>
        <Button type="submit" variant={unchanged ? 'secondary' : 'primary'} className="self-start" disabled={unchanged}>
          Save
        </Button>
      </form>
    </Card>
  )
}

// ── Reminder rules ──────────────────────────────────────────────────────────

const MODES: { value: ReminderMode; label: string }[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'needs_approval', label: 'Ask me first' },
  { value: 'off', label: 'Off' },
]

function ReminderRules() {
  const { reminderRules: rules, firm } = useData()
  const { updateRule, updateFirm } = useStore.getState()
  return (
    <Card>
      <CardHeader size="section" className="px-5 py-4" title="Reminder rules" sub="These decide which reminders are scheduled, and whether they wait for you." />
      <ul>
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-semibold">{rule.label}</p>
              <p className="text-[13px] text-muted">{rule.description}</p>
            </div>
            {rule.id !== 'student_late' && rule.id !== 'parent_late' && (
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <input type="number" min={1} max={14} className={cx(inputBase, 'w-16 text-center')} value={rule.days} onChange={(e) => updateRule(rule.id, { days: Math.max(1, Number(e.target.value) || 1) })} aria-label={`Days for: ${rule.label}`} />
                {rule.id === 'parent_escalation' ? 'days late' : 'days before'}
              </label>
            )}
            <SegmentedControl label={`Mode for: ${rule.label}`} value={rule.mode} onChange={(mode) => updateRule(rule.id, { mode })} options={MODES} />
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
        Scheduled reminders use fixed wording. Reminders you start with a “Remind” button are drafted by the AI and always wait for you. Anything else the AI writes (reports, recaps, feedback) always waits for your approval, whatever these are set
        to.
      </p>
      <label className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <span className="min-w-[14rem] flex-1">
          <span className="block text-sm font-semibold">Weekly text day</span>
          <span className="block text-[13px] text-muted">The day each week’s texts to students start on.</span>
        </span>
        <select className={inputBase} value={firm.weeklyTextDay} onChange={(e) => updateFirm({ weeklyTextDay: Number(e.target.value) })}>
          {WEEKDAYS.map((name, day) => (
            <option key={name} value={day}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </Card>
  )
}

// ── Appearance ──────────────────────────────────────────────────────────────

/**
 * Light or dark. Follows the device until that is switched off; then the
 * counselor chooses. Kept in this browser, not with the firm.
 */
function AppearanceSetting() {
  const { appearance, theme } = useAppearance()
  const auto = appearance === 'auto'
  return (
    <Card className="flex flex-col items-start gap-3 p-5">
      <CardHeader size="section" title="Appearance" sub="Kept in this browser." />
      <CheckRow checked={auto} onChange={(on) => setAppearance(on ? 'auto' : theme)} hint={auto ? `Showing ${theme} now` : 'Off: choose below'}>
        Match this device
      </CheckRow>
      {!auto && (
        <SegmentedControl
          label="Appearance"
          value={theme}
          onChange={setAppearance}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      )}
    </Card>
  )
}

// ── Demo data ───────────────────────────────────────────────────────────────

function DemoData() {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { resetDemo, startEmpty } = useStore.getState()
  const [busy, setBusy] = useState<'reset' | 'empty'>()
  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHeader size="section" title="Demo data" sub="Both delete every student, task, meeting and message in your firm. Each asks you to type a word first." />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          busy={busy === 'reset'}
          disabled={Boolean(busy)}
          onClick={async () => {
            // Deleting a firm's data cannot be undone, so it takes a typed word, not a click.
            const yes = await confirm({
              title: 'Reset demo',
              body: 'Reset to the sample caseload? This permanently deletes every student, task, meeting and message in your firm and loads the invented demo students.',
              action: 'Reset demo',
              word: 'RESET',
              wrongWord: 'Nothing was changed. Type RESET exactly to confirm.',
            })
            if (!yes) return
            setBusy('reset')
            // Said only once it has happened: a counselor who is not the owner can be refused.
            const done = await resetDemo()
            setBusy(undefined)
            if (!done) return
            navigate('/app/today')
            toast('Sample caseload loaded.')
          }}
        >
          Reset demo
        </Button>
        <Button
          variant="danger"
          busy={busy === 'empty'}
          disabled={Boolean(busy)}
          onClick={async () => {
            const yes = await confirm({
              title: 'Start empty',
              body: 'Start with an empty firm? This permanently deletes every student, task, meeting and message in your firm.',
              action: 'Start empty',
              word: 'DELETE',
              wrongWord: 'Nothing was changed. Type DELETE exactly to confirm.',
            })
            if (!yes) return
            setBusy('empty')
            const done = await startEmpty()
            setBusy(undefined)
            if (!done) return
            navigate('/app/students')
            toast('Empty firm ready. Add your first student.')
          }}
        >
          Start empty
        </Button>
      </div>
    </Card>
  )
}
