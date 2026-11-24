// "Add a file" on the student's own page: drop, pick, or take a photo. No
// login and no questions: the file goes straight to storage with a one-time
// token and the counselor's side sorts it. The student sees a confirmation and
// the names of the files added in this visit. The link can never list, open or
// download anything, so that list lives only in this page's memory.

import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { FILE_ACCEPT, FILE_TYPES_LABEL } from '../../../shared/files'
import { useFileDrop } from '../../components/files/UploadWindow'
import { Button, Card, cx } from '../../components/ui'
import { studentLinkUpload } from '../../services/files'
import { useStore } from '../../store/store'

interface Item {
  key: string
  file: File
  stage: 'sending' | 'added' | 'failed'
  progress: number
  name?: string
  error?: string
}

export function AddFile({ counselorName }: { counselorName: string }) {
  const token = useStore((s) => (s.mode === 'student_link' ? s.linkToken : undefined))
  const [items, setItems] = useState<Item[]>([])
  const pick = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const patch = (key: string, change: Partial<Item>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...change } : i)))

  const send = async (key: string, file: File) => {
    if (!token) return
    patch(key, { stage: 'sending', progress: 0, error: undefined })
    try {
      const name = await studentLinkUpload(token, file, (progress) => patch(key, { progress }))
      patch(key, { stage: 'added', name })
    } catch (e) {
      patch(key, { stage: 'failed', error: e instanceof Error ? e.message : 'That did not work. Try again.' })
    }
  }
  const add = (files: File[]) => {
    for (const file of files) {
      const key = crypto.randomUUID()
      setItems((all) => [...all, { key, file, stage: 'sending', progress: 0 }])
      void send(key, file)
    }
  }
  const drop = useFileDrop(add)
  const added = items.filter((i) => i.stage === 'added')

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-[15px] font-semibold">Add a file</h2>
      {!token ? (
        // The counselor's preview of this page: there is no link to upload through.
        <p className="text-sm text-muted">On their own link, the student can drop, pick or photograph a file here. It is sorted into their folders for you.</p>
      ) : (
        <>
          <div {...drop.handlers} className={cx('flex flex-col items-center gap-2 rounded-control border-2 border-dashed px-3 py-4 text-center', drop.over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2')}>
            <Upload size={20} strokeWidth={1.75} className="text-muted" aria-hidden />
            <p className="text-sm text-ink-soft">A transcript, a score report, a form: anything {counselorName} asked for.</p>
            <div className="flex w-full flex-col gap-2">
              <Button variant="primary" className="w-full" onClick={() => pick.current?.click()}>
                Choose a file
              </Button>
              <Button className="w-full" onClick={() => camera.current?.click()}>
                Take a photo
              </Button>
            </div>
            <p className="text-xs text-muted">{FILE_TYPES_LABEL}. Up to 25 MB.</p>
            <input
              ref={pick}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="sr-only"
              aria-label="Choose a file to add"
              onChange={(e) => {
                add([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <input
              ref={camera}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              className="sr-only"
              aria-label="Take a photo to add"
              onChange={(e) => {
                add([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>

          {items
            .filter((i) => i.stage !== 'added')
            .map((item) => (
              <div key={item.key} className="flex flex-col gap-1">
                <span className="break-all text-sm font-medium">{item.file.name}</span>
                {item.stage === 'sending' ? (
                  <>
                    <div role="progressbar" aria-label={`Sending ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} className="h-2 overflow-hidden rounded-full bg-track">
                      <div className="motion-progress h-2 bg-accent" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </div>
                    <span className="text-[13px] text-muted">{item.progress >= 1 ? 'Almost done…' : `Sending… ${Math.round(item.progress * 100)}%`}</span>
                  </>
                ) : (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad-line bg-bad-tint px-3 py-2">
                    <p className="min-w-0 flex-1 text-[13px] text-bad">
                      <strong>Not added.</strong> {item.error}
                    </p>
                    <div className="flex gap-2">
                      <Button onClick={() => void send(item.key, item.file)}>Try again</Button>
                      <Button variant="quiet" onClick={() => setItems((all) => all.filter((i) => i.key !== item.key))}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}

          {added.length > 0 && (
            <div role="status" className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
              <p className="font-semibold">
                {added.length === 1 ? 'Added. ' : `${added.length} files added. `}
                {counselorName} has {added.length === 1 ? 'it' : 'them'} now.
              </p>
              <ul className="mt-1 list-disc pl-5 text-[13px]">
                {added.map((i) => (
                  <li key={i.key} className="break-all">
                    {i.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
