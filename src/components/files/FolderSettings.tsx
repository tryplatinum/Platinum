// Settings, Folders: the firm's own list of folders files are sorted
// into, and the switch for sorting with AI. Only the firm's owner can change
// either; the database refuses anyone else, and this screen says so.

import { useState } from 'react'
import { foldersInOrder } from '../../lib/files'
import { useData, useStore } from '../../store/store'
import type { DocumentType, FolderSensitivity } from '../../types'
import { Button, Card, CardHeader, Pill, SectionLabel, cx, inputBase } from '../ui'

const WHO: Record<FolderSensitivity, string> = { standard: 'Everyone in the firm', restricted: 'Owner only', firm_only: 'Owner only (firm paperwork)' }

function FolderForm({ folder, onDone }: { folder?: DocumentType; onDone: () => void }) {
  const data = useData()
  const { addFolder, updateFolder } = useStore.getState()
  const [name, setName] = useState(folder?.name ?? '')
  const [description, setDescription] = useState(folder?.description ?? '')
  const [sensitivity, setSensitivity] = useState<FolderSensitivity>(folder?.sensitivity ?? 'standard')
  const taken = data.documentTypes.some((f) => f.id !== folder?.id && f.name.toLowerCase() === name.trim().toLowerCase())
  return (
    <form
      className="flex flex-col gap-3 rounded-lg bg-canvas p-3"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!name.trim() || taken) return
        if (folder) updateFolder(folder.id, { name, description, sensitivity })
        else addFolder({ name, description, sensitivity })
        onDone()
      }}
    >
      <label>
        <span className="mb-1 block text-xs font-semibold text-muted">Folder name</span>
        <input className={cx(inputBase, 'w-full')} autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        {taken && <span className="mt-1 block text-xs text-bad">There is already a folder with that name.</span>}
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold text-muted">What goes in it (one line; the AI reads this when it sorts)</span>
        <input className={cx(inputBase, 'w-full')} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold text-muted">Who can open its files</span>
        <select className={cx(inputBase, 'w-full')} value={sensitivity} onChange={(e) => setSensitivity(e.target.value as FolderSensitivity)}>
          <option value="standard">Everyone in the firm</option>
          <option value="restricted">The firm’s owner only</option>
          <option value="firm_only">The firm’s owner only (the firm’s own paperwork)</option>
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!name.trim() || taken}>
          {folder ? 'Save folder' : 'Add folder'}
        </Button>
      </div>
    </form>
  )
}

export function FolderSettings() {
  const data = useData()
  const owner = useStore((s) => s.account.status === 'ready' && s.account.role === 'owner')
  const { updateFirm, moveFolder, archiveFolder } = useStore.getState()
  const [editing, setEditing] = useState<string>()
  const folders = foldersInOrder(data)

  return (
    <Card className="flex flex-col items-stretch gap-3 p-5">
      <CardHeader size="section" title="Folders" />
      {!owner && <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] text-muted">Only the firm’s owner can change the folders and this setting.</p>}

      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={data.firm.sortFilesAutomatically} disabled={!owner} onChange={(e) => updateFirm({ sortFilesAutomatically: e.target.checked })} />
        <span className="text-sm">
          <span className="font-semibold">Sort files automatically</span>
          <span className="block text-[13px] text-muted">
            On: the AI reads the first two pages of each upload to choose a folder and a title. A student’s upload is filed straight away; yours waits for you with a suggestion. Off: every upload lands under Other to be checked, and nothing is sent to the AI.
          </span>
        </span>
      </label>

      <ul className="flex flex-col">
        {folders.map((f, i) => (
          <li key={f.id} className="border-t border-line py-2">
            {editing === f.id ? (
              <FolderForm folder={f} onDone={() => setEditing(undefined)} />
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-[10rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {f.name}
                    {f.sensitivity !== 'standard' && <Pill tone="warn">{WHO[f.sensitivity]}</Pill>}
                    {f.archivedAt && <Pill>Archived</Pill>}
                  </div>
                  {f.description && <p className="text-[13px] text-muted">{f.description}</p>}
                </div>
                {owner && (
                  <div className="flex flex-wrap items-center gap-1">
                    <Button variant="quiet" className="px-2" disabled={i === 0} aria-label={`Move ${f.name} up`} onClick={() => moveFolder(f.id, -1)}>
                      ↑
                    </Button>
                    <Button variant="quiet" className="px-2" disabled={i === folders.length - 1} aria-label={`Move ${f.name} down`} onClick={() => moveFolder(f.id, 1)}>
                      ↓
                    </Button>
                    <Button variant="quiet" className="px-2" aria-label={`Edit ${f.name}`} onClick={() => setEditing(f.id)}>
                      Edit
                    </Button>
                    <Button variant="quiet" className="px-2" aria-label={`${f.archivedAt ? 'Restore' : 'Archive'} ${f.name}`} onClick={() => archiveFolder(f.id, !f.archivedAt)}>
                      {f.archivedAt ? 'Restore' : 'Archive'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {owner && (editing === 'new' ? <FolderForm onDone={() => setEditing(undefined)} /> : <Button onClick={() => setEditing('new')}>Add a folder</Button>)}
      <SectionLabel className="normal-case tracking-normal">Archiving moves nothing: files keep their folder and show it as archived. It only stops new files going in.</SectionLabel>
    </Card>
  )
}
