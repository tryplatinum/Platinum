// Create, copy and replace the secret link that opens a student's own page.
// The token is shown once, right after it is generated. It is not stored.
// Replacing a link changes the hash, so the previous address stops working.

import { useState } from 'react'
import { studentLinkUrl } from '../../shared/dispatch'
import { formatTimestamp } from '../lib/dates'
import { forgetStudentLink } from '../lib/studentLinks'
import { useStore } from '../store/store'
import type { Student } from '../types'
import { Button, LinkButton, Modal, SectionLabel, inputClass, useToast } from './ui'

export function StudentLinkModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const links = useStore((s) => s.studentLinks).filter((l) => l.studentId === student.id)
  const { createStudentLink, rotateStudentLink, revokeStudentLink } = useStore.getState()
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

  const copy = (url: string) =>
    attempt(async () => {
      await navigator.clipboard.writeText(url)
      toast('Link copied. Send it to the student yourself.')
    })

  return (
    <Modal title={`${student.firstName}’s link`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-ink-soft">
          A private link that opens {student.firstName}’s own page on their phone, with no login. They see their tasks, next meeting, deadlines, and the recap and essay feedback you have approved. They can
          mark tasks done, leave a note, and attach a link. Anyone who has the link can do the same, so send it only to {student.firstName}. The link can be copied only right after it is generated.
        </p>

        <div>
          <LinkButton to={`/student/${student.id}`}>Preview as student</LinkButton>
        </div>

        {fresh ? (
          <div className="flex flex-col gap-2 rounded-lg border border-accent-line bg-accent-soft p-3">
            <SectionLabel>New link</SectionLabel>
            <input className={inputClass} readOnly value={fresh} aria-label="Student link" onFocus={(e) => e.target.select()} />
            <div>
              <Button variant="primary" onClick={() => void copy(fresh)} disabled={busy}>
                Copy link
              </Button>
            </div>
          </div>
        ) : (
          links.length === 0 && (
            <div>
              <Button
                variant="primary"
                onClick={() =>
                  void attempt(async () => {
                    const token = await createStudentLink(student.id)
                    setFresh(studentLinkUrl(window.location.origin, token))
                  })
                }
                disabled={busy}
              >
                Create link
              </Button>
            </div>
          )
        )}

        <div>
          <SectionLabel>Active links</SectionLabel>
          {links.length === 0 ? (
            <p className="mt-1 text-sm text-muted">None. {student.firstName} cannot open their page until you create one.</p>
          ) : (
            <ul className="mt-1">
              {links.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
                  <span>Created {formatTimestamp(link.createdAt)}</span>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void attempt(async () => {
                        const token = await rotateStudentLink(link.id)
                        forgetStudentLink(student.id)
                        setFresh(studentLinkUrl(window.location.origin, token))
                        toast('New link ready. The previous one has stopped working.')
                      })
                    }
                  >
                    Generate new link (the old link stops working)
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void attempt(async () => {
                        await revokeStudentLink(link.id)
                        forgetStudentLink(student.id)
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
