// One student. Header with status and the two things a counselor does most
// (remind, log a meeting), then six tabs kept in the URL.

import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { LogMeetingModal } from '../../components/forms'
import { ReminderComposer } from '../../components/ReminderComposer'
import { StudentLinkModal } from '../../components/StudentLinkModal'
import { Button, Modal, PageHeader, StatusPill, Tabs, useTab, type TabItem } from '../../components/ui'
import { MEETING_APPROVAL_KINDS, allPendingApprovals, essaysFor, findStudent, fullName, sortByUrgency, summarize, tasksFor, isOpen } from '../../lib/derive'
import { reminderQueue } from '../../lib/reminders'
import { useData } from '../../store/store'
import DocumentsTab from './student/DocumentsTab'
import EssaysTab from './student/EssaysTab'
import MeetingsTab from './student/MeetingsTab'
import Overview from './student/Overview'
import ProfileTab from './student/ProfileTab'
import ReportsTab from './student/ReportsTab'

type TabKey = 'overview' | 'meetings' | 'documents' | 'essays' | 'reports' | 'profile'

export default function StudentPage() {
  const data = useData()
  const { studentId } = useParams()
  const student = findStudent(data, studentId)
  const [modal, setModal] = useState<'remind' | 'log' | 'link'>()

  const approvals = student ? allPendingApprovals(data, reminderQueue(data), student.id) : []
  const tabs: TabItem<TabKey>[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'meetings', label: 'Meetings', count: approvals.filter((a) => MEETING_APPROVAL_KINDS.includes(a.kind)).length },
    { key: 'documents', label: 'Documents' },
    { key: 'essays', label: 'Essays', count: student ? essaysFor(data, student.id).filter((e) => e.status === 'needs_feedback' || e.feedback?.review === 'pending').length : 0 },
    { key: 'reports', label: 'Parent reports', count: approvals.filter((a) => a.kind === 'report').length },
    { key: 'profile', label: 'Profile' },
  ]
  const tab = useTab(tabs)
  if (!student) return <Navigate to="/app/students" replace />

  const summary = summarize(data, student)
  const waiting = approvals.length
  // The task a reminder would be about: the most overdue one that is not the counselor's own.
  const remindTask = sortByUrgency(tasksFor(data, student.id).filter((t) => isOpen(t) && t.owner !== 'counselor'))[0]
  const facts = [
    `Class of ${student.gradYear}`,
    student.school,
    student.gpa ? `GPA ${student.gpa.toFixed(2)}` : '',
    student.tests.sat ? `SAT ${student.tests.sat}` : student.tests.act ? `ACT ${student.tests.act}` : '',
    student.majors.slice(0, 2).join(', '),
  ].filter(Boolean)

  return (
    <>
      <PageHeader
        above={
          <>
            <Link to="/app/students" className="font-medium text-accent hover:underline">
              Students
            </Link>{' '}
            / {fullName(student)}
            {student.archived && ' · archived'}
          </>
        }
        title={
          <>
            {fullName(student)}
            {student.localName && <span className="ml-2 text-xl font-medium text-muted">{student.localName}</span>}
          </>
        }
        pill={<StatusPill status={summary.status} />}
        sub={
          <>
            {facts.join(' · ')}
            {waiting > 0 && (
              <>
                {' · '}
                <Link to={`/app?student=${student.id}`} className="font-medium text-accent hover:underline">
                  Waiting for review ({waiting})
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            <Button onClick={() => setModal('link')}>Student link</Button>
            <Button variant="remind" onClick={() => setModal('remind')} disabled={!remindTask}>
              Remind
            </Button>
            <Button variant="primary" onClick={() => setModal('log')}>
              Log a meeting
            </Button>
          </>
        }
      />
      <Tabs tabs={tabs} label={`${student.firstName}’s pages`} />

      {tab === 'overview' && <Overview student={student} />}
      {tab === 'meetings' && <MeetingsTab student={student} />}
      {tab === 'documents' && <DocumentsTab student={student} />}
      {tab === 'essays' && <EssaysTab student={student} />}
      {tab === 'reports' && <ReportsTab student={student} />}
      {tab === 'profile' && <ProfileTab student={student} />}

      {modal === 'link' && <StudentLinkModal student={student} onClose={() => setModal(undefined)} />}
      {modal === 'log' && <LogMeetingModal studentId={student.id} onClose={() => setModal(undefined)} />}
      {modal === 'remind' && remindTask && (
        <Modal title={`Remind about “${remindTask.title}”`} onClose={() => setModal(undefined)} wide>
          <ReminderComposer student={student} task={remindTask} onDone={() => setModal(undefined)} />
        </Modal>
      )}
    </>
  )
}
