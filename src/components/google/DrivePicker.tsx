// Choosing files in Google Drive. drive.file only covers files the counselor
// picks (or that this app creates), so this panel opens Google's Picker instead
// of listing My Drive. Listings are not saved. Nothing in Drive is changed.

import { useState } from 'react'
import type { LinkedFolder } from '../../../shared/google'
import { todayISO } from '../../lib/dates'
import { fullName } from '../../lib/derive'
import { GoogleFailure, callGoogle } from '../../services/google'
import type { DocumentRow } from '../../services/files'
import { useStore } from '../../store/store'
import type { Student } from '../../types'
import { Button, Modal, cx } from '../ui'

interface Result {
  id: string
  name: string
  state: 'waiting' | 'working' | 'added' | 'already' | 'failed'
  note?: string
}

interface PickedDoc {
  id: string
  name: string
  mimeType?: string
}

const reasonOf = (error: unknown) => (error instanceof GoogleFailure ? error.message : 'Something went wrong. Please try again.')
const PICKER_KEY = (import.meta.env.VITE_GOOGLE_PICKER_KEY as string | undefined)?.trim()
const APP_ID = (import.meta.env.VITE_GOOGLE_APP_ID as string | undefined)?.trim()

type PickerBuilder = {
  addView: (view: unknown) => PickerBuilder
  setOAuthToken: (token: string) => PickerBuilder
  setDeveloperKey: (key: string) => PickerBuilder
  setAppId: (id: string) => PickerBuilder
  setTitle: (title: string) => PickerBuilder
  setCallback: (cb: (data: { action: string; docs?: PickedDoc[] }) => void) => PickerBuilder
  enableFeature: (feature: unknown) => PickerBuilder
  build: () => { setVisible: (visible: boolean) => void }
}

type DocsView = {
  setIncludeFolders: (on: boolean) => DocsView
  setSelectFolderEnabled: (on: boolean) => DocsView
  setMimeTypes: (types: string) => DocsView
}

type PickerApi = {
  picker: {
    PickerBuilder: new () => PickerBuilder
    DocsView: new (viewId: string) => DocsView
    ViewId: { DOCS: string; FOLDERS: string }
    Feature: { MULTISELECT_ENABLED: unknown }
    Action: { PICKED: string; CANCEL: string }
  }
}

function pickerApi(): PickerApi | undefined {
  return (window as unknown as { google?: PickerApi }).google
}

function loadPicker(): Promise<void> {
  const existing = (window as unknown as { gapi?: { load: (name: string, options: { callback: () => void; onerror?: () => void }) => void } }).gapi
  const ready = () =>
    new Promise<void>((resolve, reject) => {
      const gapi = (window as unknown as { gapi?: { load: (name: string, options: { callback: () => void; onerror?: () => void }) => void } }).gapi
      if (!gapi) {
        reject(new Error('Google Picker could not be loaded.'))
        return
      }
      gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Google Picker could not be loaded.')) })
    })
  if (existing) return ready()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.async = true
    script.onload = () => void ready().then(resolve, reject)
    script.onerror = () => reject(new Error('Google Picker could not be loaded.'))
    document.head.appendChild(script)
  })
}

export function DrivePicker({ mode, student, onClose, onLinked }: { mode: 'files' | 'folder'; student?: Student; onClose: () => void; onLinked?: (folder: LinkedFolder) => void }) {
  const { takeFiles, suggestFile } = useStore.getState()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>()

  const title = mode === 'folder' ? `Link a Drive folder to ${student ? fullName(student) : 'a student'}` : student ? `Add from Google Drive for ${fullName(student)}` : 'Add from Google Drive'

  const importFiles = async (docs: PickedDoc[]) => {
    const list: Result[] = docs.map((doc) => ({ id: doc.id, name: doc.name, state: 'waiting' }))
    setResults(list)
    const set = (id: string, change: Partial<Result>) => setResults((all) => all?.map((row) => (row.id === id ? { ...row, ...change } : row)))
    for (const doc of docs) {
      set(doc.id, { state: 'working' })
      try {
        const done = await callGoogle<{ document: DocumentRow; already: boolean; sameAs?: string }>('import', { fileId: doc.id, ...(student ? { studentId: student.id } : {}), today: todayISO() }, 75_000)
        takeFiles([done.document])
        if (done.already) set(doc.id, { state: 'already', note: 'Already imported.' })
        else {
          set(doc.id, { state: 'added', note: done.sameAs ? `Added. ${student?.firstName ?? 'This student'} already has a file with the same contents: “${done.sameAs}”.` : 'Added.' })
          void suggestFile(done.document.id)
        }
      } catch (e) {
        set(doc.id, { state: 'failed', note: reasonOf(e) })
      }
    }
  }

  const choose = async () => {
    if (!PICKER_KEY) {
      setError('Google Picker is not set up on this server.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const { token } = await callGoogle<{ token: string }>('picker')
      await loadPicker()
      const google = pickerApi()
      if (!google) throw new Error('Google Picker could not be loaded.')
      const view =
        mode === 'folder'
          ? new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder')
          : new google.picker.DocsView(google.picker.ViewId.DOCS)
      let builder = new google.picker.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(PICKER_KEY).setTitle(title).setCallback((data) => {
        if (data.action !== google.picker.Action.PICKED || !data.docs?.length) return
        if (mode === 'folder') {
          const folder = data.docs[0]
          if (!student || !folder) return
          setBusy(true)
          void callGoogle<LinkedFolder>('link', { folderId: folder.id, studentId: student.id })
            .then((linked) => {
              onLinked?.(linked)
              onClose()
            })
            .catch((e) => {
              setError(reasonOf(e))
              setBusy(false)
            })
          return
        }
        void importFiles(data.docs)
      })
      if (mode === 'files') builder = builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      if (APP_ID) builder = builder.setAppId(APP_ID)
      builder.build().setVisible(true)
    } catch (e) {
      setError(reasonOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (results) {
    const working = results.some((row) => row.state === 'waiting' || row.state === 'working')
    const finished = results.filter((row) => row.state !== 'waiting' && row.state !== 'working').length
    const added = results.filter((row) => row.state === 'added').length
    return (
      <Modal title={title} onClose={onClose} wide>
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm font-semibold">
            {working ? `Imported ${finished} of ${results.length}…` : `Imported ${added} of ${results.length}.`}
          </p>
          <ul className="flex flex-col gap-2">
            {results.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="min-w-0 break-all text-sm font-medium">{row.name}</span>
                <span className={cx('text-[13px]', row.state === 'failed' ? 'text-bad' : row.state === 'added' ? 'text-good' : 'text-muted')}>
                  {row.state === 'waiting' ? 'Waiting…' : row.state === 'working' ? 'Copying from Drive…' : row.state === 'failed' ? `Not added. ${row.note}` : row.note}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-muted">{working ? 'Keep this window open until every file is copied.' : 'Nothing in Drive was changed.'}</p>
            <div className="flex gap-2">
              {!working && <Button onClick={() => setResults(undefined)}>Choose more</Button>}
              <Button variant="primary" disabled={working} onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          {mode === 'folder'
            ? 'Choose one folder in Google Drive. Platinum can only see files in it that you also pick, or that Platinum created. It does not read the rest of the folder, and it never changes Drive.'
            : 'Choose the files in Google Drive. Platinum can open only those files. PDF, JPEG, PNG, HEIC, Word and Excel up to 25 MB. Google Docs, Sheets and Slides are saved as PDFs. Nothing in Drive is changed.'}
        </p>
        {error && (
          <p role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void choose()}>
            {mode === 'folder' ? 'Choose a folder' : 'Choose files'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
