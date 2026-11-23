// Create, copy and revoke the secret link that opens a student's own page on
// their phone without a login. The link is shown once, when it is made: only a
// hash of it is stored, so nobody (including us) can read it back later.

import { useState } from 'react'
import { formatTimestamp } from '../lib/dates'
import { useStore } from '../store/store'
import type { Student } from '../types'
import { Button, Modal, SectionLabel, inputClass, useToast } from './ui'

export function StudentLinkModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const links = useStore((s) => s.studentLinks).filter((l) => l.studentId === student.id)
  const { createStudentLink, revokeStudentLink } = useStore.getState()
  const toast = useToast()
  const [fresh, setFresh] = useState('')
  const [busy, setBusy] = useState(false)

  const attempt = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    attempt(async () => {
      const token = await createStudentLink(student.id)
      setFresh(`${window.location.origin}/s/${token}`)
    })

  const copy = () =>
    attempt(async () => {
      await navigator.clipboard.writeText(fresh)
      toast('Link copied. Send it to the student yourself.')
    })

  return (
    <Modal title={`${student.firstName}’s link`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-ink-soft">
          A private link that opens {student.firstName}’s own page on their phone, with no login. They see their tasks, next meeting, deadlines, and the recap and essay feedback you have approved. They can
          mark tasks done, leave a note, and attach a link. Anyone who has the link can do the same, so send it only to {student.firstName}.
        </p>

        {fresh ? (
          <div className="flex flex-col gap-2 rounded-lg border border-accent-line bg-accent-soft p-3">
            <SectionLabel>New link. Copy it now: it cannot be shown again.</SectionLabel>
            <input className={inputClass} readOnly value={fresh} aria-label="Student link" onFocus={(e) => e.target.select()} />
            <div>
              <Button variant="primary" onClick={() => void copy()} disabled={busy}>
                Copy link
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="primary" onClick={() => void create()} disabled={busy}>
              {links.length ? 'Create another link' : 'Create link'}
            </Button>
          </div>
        )}

        <div>
          <SectionLabel>Active links</SectionLabel>
          {links.length === 0 ? (
            <p className="mt-1 text-sm text-muted">None. {student.firstName} cannot open their page until you create one.</p>
          ) : (
            <ul className="mt-1">
              {links.map((link) => (
                <li key={link.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
                  <span>Created {formatTimestamp(link.createdAt)}</span>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void attempt(async () => {
                        await revokeStudentLink(link.id)
                        toast('Link revoked. It no longer opens anything.')
                      })
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
