// The review surface for brand changes: every shared component in each state,
// with the tokens they are built from. Open /app/styleguide; it is not in the
// navigation. Nothing here reads or writes the firm's data.

import { FolderOpen } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Logo, Spark } from '../../components/Logo'
import {
  AiErrorNote,
  AiTag,
  ApprovalStamp,
  Button,
  Card,
  CardHeader,
  CheckCircle,
  DateChip,
  Empty,
  Field,
  FilterChips,
  LinkButton,
  Modal,
  OwnerChip,
  PageHeader,
  Pill,
  PlaceholderNote,
  ProgressWithCount,
  ReviewTag,
  SectionLabel,
  SegmentedControl,
  StatusPill,
  Tabs,
  Thinking,
  inputBase,
  inputClass,
  textareaClass,
  useAi,
  useTab,
  useToast,
  type TabItem,
} from '../../components/ui'
import { todayISO } from '../../lib/dates'
import type { Review } from '../../types'

const COLORS = [
  ['canvas', 'bg-canvas', 'page background'],
  ['surface', 'bg-surface', 'cards, modals'],
  ['surface-2', 'bg-surface-2', 'table headers, hover rows, disabled inputs'],
  ['chip / track / line', 'bg-chip', 'neutral tags, empty progress, card borders'],
  ['line-strong', 'bg-line-strong', 'input, checkbox and secondary button edges'],
  ['silver', 'bg-silver', 'decoration only, never text'],
  ['heading', 'bg-heading', 'h1 to h3, card titles'],
  ['primary', 'bg-primary', 'filled buttons; text on them is on-primary'],
  ['ink', 'bg-ink', 'body text'],
  ['ink-soft', 'bg-ink-soft', 'emphasised secondary text, chip text'],
  ['muted', 'bg-muted', 'secondary text'],
  ['accent', 'bg-accent', 'links, selected tab, focus ring, AI'],
  ['accent-soft', 'bg-accent-soft', 'AI panels'],
  ['accent-soft-2', 'bg-accent-soft-2', 'selected chips'],
  ['good', 'bg-good', 'on track, done, approved'],
  ['good-soft', 'bg-good-soft', ''],
  ['warn', 'bg-warn', 'slipping, check these, placeholder'],
  ['warn-soft', 'bg-warn-soft', ''],
  ['bad', 'bg-bad', 'behind, late, errors'],
  ['bad-soft', 'bg-bad-soft', ''],
  ['bad-tint', 'bg-bad-tint', 'late rows, error notes'],
] as const

const TABS: TabItem<'one' | 'two' | 'three'>[] = [
  { key: 'one', label: 'Overview' },
  { key: 'two', label: 'Tasks', count: 4 },
  { key: 'three', label: 'Documents' },
]

/** `plain` is for a block that shows cards, so that no card sits inside a card. */
function Block({ title, children, plain }: { title: string; children: ReactNode; plain?: boolean }) {
  if (plain) {
    return (
      <section className="flex flex-col gap-4">
        <CardHeader size="section" title={title} />
        {children}
      </section>
    )
  }
  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHeader size="section" title={title} />
      {children}
    </Card>
  )
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-3">{children}</div>

/** A colour sample. The value is read from the page, so no colour is written in this file. */
function Swatch({ name, className, use }: { name: string; className: string; use: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState('')
  useEffect(() => {
    if (!ref.current) return
    const rgb = getComputedStyle(ref.current).backgroundColor.match(/\d+/g)
    if (rgb) setValue(`#${rgb.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase())
  }, [])
  return (
    <div className="flex items-center gap-3">
      <div ref={ref} className={`h-11 w-11 shrink-0 rounded-control border border-line ${className}`} />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{name}</div>
        <div className="nums text-xs text-muted">
          {value}
          {use && ` · ${use}`}
        </div>
      </div>
    </div>
  )
}

export default function Styleguide() {
  const toast = useToast()
  const ai = useAi()
  const tab = useTab(TABS, 'sg')
  const [segment, setSegment] = useState<'local' | 'en' | 'both'>('both')
  const [filter, setFilter] = useState<'all' | 'behind' | 'slipping'>('all')
  const [checked, setChecked] = useState(false)
  const [progress, setProgress] = useState(2)
  const [review, setReview] = useState<Review>('pending')
  const [modal, setModal] = useState(false)
  const [draft, setDraft] = useState(false)

  return (
    <>
      <PageHeader
        above="Not in the navigation · /app/styleguide"
        title="Styleguide"
        sub="Every shared component in each state. Review brand changes here before they reach a screen."
        pill={<Pill tone="accent">Internal</Pill>}
        actions={
          <>
            <Button>Secondary</Button>
            <Button variant="primary">Primary</Button>
          </>
        }
      />

      <Block title="Logo" plain>
        <Row>
          <Logo width={240} />
          <Logo width={148} />
          <Logo variant="symbol" width={64} />
          <Logo variant="symbol" width={40} />
          <Spark size={16} />
          <Spark size={14} />
        </Row>
        <p className="text-[13px] text-muted">Cropped and resized from the master, never redrawn or recoloured. It keeps its porcelain background: invisible on the light canvas, a light tile in the dark. The spark is the logo’s own star and marks AI work; it is the only decorative use of the logo’s shapes.</p>
      </Block>

      <Block title="Colour">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {COLORS.map(([name, className, use]) => (
            <Swatch key={name} name={name} className={className} use={use} />
          ))}
        </div>
      </Block>

      <Block title="Type">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Page title · 28 / 600 Manrope</h1>
          <h2 className="text-lg font-semibold">Section title · 18 / 600 Manrope</h2>
          <h3 className="text-base font-semibold">Card title · 16 / 600 Manrope</h3>
          <p className="text-sm">Body · 14 Inter. Kevin’s Common App essay is due on Friday.</p>
          <p className="text-[13px] text-muted">Secondary · 13 Inter, muted.</p>
          <SectionLabel>Label · 12 semibold</SectionLabel>
          <p className="nums text-sm">Tabular numerals: 1,234 · 11/15 · 08:30</p>
          <p lang="zh-Hans" className="text-sm">
            中文示例：家长报告将于周五发送。
          </p>
        </div>
      </Block>

      <Block title="Buttons">
        <Row>
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="remind">Remind</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
          <LinkButton to="/app/styleguide">Link button</LinkButton>
        </Row>
        <Row>
          <Button variant="primary" disabled>
            Primary
          </Button>
          <Button disabled>Secondary</Button>
          <Button variant="remind" disabled>
            Remind
          </Button>
          <Button variant="quiet" disabled>
            Quiet
          </Button>
          <Button variant="danger" disabled>
            Danger
          </Button>
        </Row>
      </Block>

      <Block title="Inputs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Text" hint="A hint sits under the field.">
            <input className={inputClass} placeholder="Placeholder" />
          </Field>
          <Field label="Disabled">
            <input className={inputClass} disabled value="Cannot be changed" readOnly />
          </Field>
          <Field label="Select">
            <select className={inputClass} defaultValue="b">
              <option value="a">First choice</option>
              <option value="b">Second choice</option>
            </select>
          </Field>
          <Field label="Date">
            <input type="date" className={inputBase} defaultValue={todayISO()} />
          </Field>
          <Field label="Textarea" className="sm:col-span-2">
            <textarea className={textareaClass} rows={3} defaultValue="Longer text goes here." />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5" defaultChecked />
            Checkbox, checked
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5" />
            Checkbox, empty
          </label>
        </div>
      </Block>

      <Block title="Tags">
        <Row>
          <Pill>Neutral</Pill>
          <Pill tone="accent">Accent</Pill>
          <Pill tone="good">Good</Pill>
          <Pill tone="warn">Warn</Pill>
          <Pill tone="bad">Bad</Pill>
        </Row>
        <Row>
          <StatusPill status="behind" />
          <StatusPill status="slipping" />
          <StatusPill status="on_track" />
          <StatusPill status="new" />
          <OwnerChip owner="student" label="Kevin" />
          <OwnerChip owner="parent" label="Parent" />
          <OwnerChip owner="counselor" label="You" />
        </Row>
        <Row>
          <ReviewTag review="pending" />
          <ReviewTag review="approved" />
          <ReviewTag review="dismissed" />
          <ApprovalStamp approval={{ by: 'Sarah Lindqvist', at: new Date().toISOString() }} />
        </Row>
        <Row>
          <DateChip date={todayISO()} />
          <DateChip date={todayISO()} tone="bad" />
          <DateChip date={todayISO()} tone="good" />
        </Row>
      </Block>

      <Block title="Tabs, segmented control, filter chips">
        <Tabs tabs={TABS} param="sg" label="Styleguide tabs" />
        <p className="text-[13px] text-muted">Selected: {TABS.find((t) => t.key === tab)?.label}. Arrow keys move between tabs.</p>
        <Row>
          <SegmentedControl
            label="Language shown"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'local', label: '中文' },
              { value: 'en', label: 'English' },
              { value: 'both', label: 'Side by side' },
            ]}
          />
        </Row>
        <FilterChips
          label="Filter students"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: 12 },
            { value: 'behind', label: 'Behind', count: 3 },
            { value: 'slipping', label: 'Slipping', count: 2 },
          ]}
        />
      </Block>

      <Block title="Progress and check marks">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ProgressWithCount progress={{ done: 1, total: 5, late: 2 }} status="behind" text="2 late" />
          <ProgressWithCount progress={{ done: 3, total: 5, late: 0 }} status="slipping" text="1 due soon" />
          <ProgressWithCount progress={{ done: 5, total: 5, late: 0 }} status="on_track" text="All done" />
          <ProgressWithCount progress={{ done: progress, total: 5, late: 0 }} status="new" text="Changes below" long />
        </div>
        <Row>
          <Button onClick={() => setProgress((progress + 1) % 6)}>Move the last bar</Button>
          <span className="text-[13px] text-muted">The bar eases over 400 ms when its value changes, not on first render.</span>
        </Row>
        <Row>
          <CheckCircle done={checked} label="Example task" onToggle={() => setChecked(!checked)} />
          <span className="text-sm">Press to tick: the check draws over 180 ms.</span>
          <CheckCircle done={false} label="Open" />
          <CheckCircle done={false} late label="Late" />
          <CheckCircle done label="Done" />
          <span className="text-[13px] text-muted">Open, late, done (read-only)</span>
        </Row>
      </Block>

      <Block title="AI">
        <Row>
          <AiTag />
          <AiTag source={{ kind: 'claude', model: 'model name' }} />
          <AiTag>AI brief</AiTag>
          <AiTag source={{ kind: 'placeholder', reason: 'The server has no API key.' }} />
        </Row>
        <PlaceholderNote source={{ kind: 'placeholder', reason: 'The server has no API key.' }} />
        <AiErrorNote message="The AI did not answer in time. Try again." />
        <Row>
          <Button
            variant="primary"
            disabled={ai.busy}
            onClick={() => {
              setDraft(false)
              setReview('pending')
              void ai.run(async () => {
                await new Promise((done) => setTimeout(done, 1800))
                setDraft(true)
              })
            }}
          >
            Show a draft arriving
          </Button>
          <span className="text-[13px] text-muted">Nothing is sent to the AI: this waits, then shows a sample.</span>
        </Row>
        {ai.busy && <Thinking />}
        {draft && !ai.busy && (
          <Card tone="accent" className="flex flex-col gap-3 p-5">
            <CardHeader title="Recap for Kevin" action={<AiTag />} />
            <p className="text-sm leading-relaxed">Sample text standing in for a draft. The panel fades in and the spark turns once; a draft that was already here when the page opened does neither.</p>
            <Row>
              <Button variant="primary" disabled={review === 'approved'} onClick={() => setReview('approved')}>
                Approve
              </Button>
              <ReviewTag review={review} />
            </Row>
          </Card>
        )}
        <Thinking inline label="Sorting…" />
      </Block>

      <Block title="Cards, lists and empty states" plain>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5">
            <CardHeader title="Card" count={3} sub="Radius 12, a line border, no shadow." />
          </Card>
          <Card tone="accent" className="p-5">
            <CardHeader title="AI panel" sub="On accent-soft." />
          </Card>
          <Card tone="bad" className="p-5">
            <CardHeader title="Problem" sub="On bad-tint." />
          </Card>
        </div>
        <Card>
          <CardHeader className="px-5 py-4" title="A list" count={2} />
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-xs text-muted">
                <th className="px-5 py-3 font-semibold">Student</th>
                <th className="px-3 py-3 font-semibold">Next deadline</th>
                <th className="px-3 py-3 text-right font-semibold">Tasks</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Kevin Zhang', 'Nov 30', '1/5'],
                ['Sophia Martinez', 'Dec 12', '11/14'],
              ].map(([name, date, tasks]) => (
                <tr key={name} className="border-t border-line transition-colors hover:bg-surface-2">
                  <td className="px-5 py-3 font-semibold text-heading">{name}</td>
                  <td className="px-3 py-3">{date}</td>
                  <td className="px-3 py-3 text-right">{tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <Empty title="Nothing here yet. The action that fills the list sits underneath.">
            <Button variant="primary">Add the first one</Button>
          </Empty>
        </Card>
        <Card>
          <Empty icon={FolderOpen} title="An empty state can name its own icon." />
        </Card>
      </Block>

      <Block title="Things that float">
        <Row>
          <Button onClick={() => setModal(true)}>Open a modal</Button>
          <Button onClick={() => toast('Saved. This is a toast.')}>Show a toast</Button>
        </Row>
        <p className="text-[13px] text-muted">Modals and menus fade and rise 4 px over 180 ms and close at once. Toasts slide up 8 px. With “reduce motion” on, every change is instant.</p>
      </Block>

      {modal && (
        <Modal title="A modal" onClose={() => setModal(false)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setModal(false)
            }}
          >
            <Field label="Name" hint="Radius 16, the larger shadow, and a close button with a label for screen readers.">
              <input className={inputClass} data-autofocus defaultValue="Kevin Zhang" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setModal(false)}>Cancel</Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
