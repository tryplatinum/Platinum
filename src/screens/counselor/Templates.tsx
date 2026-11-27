// Templates: the one place the firm's reusable material is managed. A list
// with a kind filter, and New, Edit, Duplicate and Archive. Using a template
// happens where the counselor already is (a student's tasks, the Students
// table, a message box, Essays), never from this page.

import { useState } from 'react'
import { TEMPLATE_KINDS, TEMPLATE_KIND_LABEL, TEMPLATE_KIND_PURPOSE, type TemplateKind } from '../../../shared/templates'
import { MotionList } from '../../components/motion'
import { TemplateEditor, summaryOf } from '../../components/templates'
import { Button, Card, CheckRow, Empty, FilterChips, PageHeader, Pill, usePageTitle, useToast } from '../../components/ui'
import { useData, useStore } from '../../store/store'
import type { Template } from '../../types'

type Filter = 'all' | TemplateKind

export default function Templates() {
  const data = useData()
  const toast = useToast()
  const { duplicateTemplate, archiveTemplate } = useStore.getState()
  const [filter, setFilter] = useState<Filter>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<{ template?: Template; kind: TemplateKind }>()
  usePageTitle('Templates')

  const all = data.templates ?? []
  const live = all.filter((t) => !t.archived)
  const archived = all.length - live.length
  const shown = (showArchived ? all : live).filter((t) => filter === 'all' || t.kind === filter)
  const usedBy = (t: Template) => data.tasks.filter((x) => x.templateId === t.id).length

  return (
    <>
      <PageHeader
        title="Templates"
        sub="Task plans, messages and handouts you make once and use on many students. You use one from a student’s tasks, the Students table, a message box or Essays."
        actions={
          <>
            {TEMPLATE_KINDS.map((k, i) => (
              <Button key={k} variant={i === 0 && live.length === 0 ? 'primary' : 'secondary'} onClick={() => setEditing({ kind: k })}>
                New {TEMPLATE_KIND_LABEL[k].toLowerCase()}
              </Button>
            ))}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label="Kind of template"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all' as Filter, label: 'All', count: live.length }, ...TEMPLATE_KINDS.map((k) => ({ value: k as Filter, label: `${TEMPLATE_KIND_LABEL[k]}s`, count: live.filter((t) => t.kind === k).length }))]}
        />
        {archived > 0 && (
          <CheckRow checked={showArchived} onChange={setShowArchived}>
            Show archived ({archived})
          </CheckRow>
        )}
      </div>

      <Card>
        {shown.length === 0 ? (
          <Empty title={filter === 'all' ? 'No templates yet. A template is something you make once and use on many students: a list of tasks with dates, a message with blanks, or a worksheet.' : `No ${TEMPLATE_KIND_LABEL[filter].toLowerCase()} templates yet. ${TEMPLATE_KIND_PURPOSE[filter]}`}>
            <Button onClick={() => setEditing({ kind: filter === 'all' ? 'task_plan' : filter })}>New {TEMPLATE_KIND_LABEL[filter === 'all' ? 'task_plan' : filter].toLowerCase()}</Button>
          </Empty>
        ) : (
          <MotionList label="Templates" itemClassName="border-t border-line first:border-t-0">
            {shown.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-[12rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill>{TEMPLATE_KIND_LABEL[t.kind]}</Pill>
                    <span className="text-sm font-semibold text-heading">{t.name}</span>
                    {t.archived && <Pill tone="warn">Archived</Pill>}
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {summaryOf(t)}
                    {usedBy(t) > 0 && ` · ${usedBy(t)} ${usedBy(t) === 1 ? 'task' : 'tasks'} made from it`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!t.archived && (
                    <Button onClick={() => setEditing({ template: t, kind: t.kind })} aria-label={`Edit ${t.name}`}>
                      Edit
                    </Button>
                  )}
                  <Button
                    variant="quiet"
                    aria-label={`Duplicate ${t.name}`}
                    onClick={() => {
                      duplicateTemplate(t.id)
                      toast(`Made a copy of “${t.name}”.`)
                    }}
                  >
                    Duplicate
                  </Button>
                  <Button
                    variant="quiet"
                    aria-label={`${t.archived ? 'Bring back' : 'Archive'} ${t.name}`}
                    onClick={() => {
                      archiveTemplate(t.id, !t.archived)
                      toast(t.archived ? `“${t.name}” is back in the list.` : `Archived “${t.name}”. What was made from it is unchanged.`)
                    }}
                  >
                    {t.archived ? 'Bring back' : 'Archive'}
                  </Button>
                </div>
              </div>
            ))}
          </MotionList>
        )}
      </Card>
      <p className="text-[13px] text-muted">Archive is not delete: tasks and drafts already made from a template keep working, and an archived template can be brought back.</p>

      {editing && <TemplateEditor key={editing.template?.id ?? editing.kind} template={editing.template} kind={editing.kind} onClose={() => setEditing(undefined)} />}
    </>
  )
}
