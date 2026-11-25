// One student. Header with status, the student link and logging a meeting, then
// six tabs kept in the URL. A reminder starts from the late task itself.

import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { LogMeetingModal } from '../../components/forms'
import { StudentLinkModal } from '../../components/StudentLinkModal'
import { Button, PageHeader, StatusPill, TabPanel, Tabs, usePageTitle, useTab, type TabItem } from '../../components/ui'
import { MEETING_APPROVAL_KINDS, essaysFor, findStudent, fullName, summarize } from '../../lib/derive'
import { inboxContents, inboxSize } from '../../lib/inbox'
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
  const [modal, setModal] = useState<'log' | 'link'>()

  const inbox = inboxContents(data, studentId)
  const approvals = student ? inbox.approvals : []
  const tabs: TabItem<TabKey>[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'meetings', label: 'Meetings', count: approvals.filter((a) => MEETING_APPROVAL_KINDS.includes(a.kind)).length },
    { key: 'documents', label: 'Documents' },
    { key: 'essays', label: 'Essays', count: student ? essaysFor(data, student.id).filter((e) => e.status === 'needs_feedback' || e.feedback?.review === 'pending').length : 0 },
    { key: 'reports', label: 'Parent reports', count: approvals.filter((a) => a.kind === 'report').length },
    { key: 'profile', label: 'Profile' },
  ]
  const tab = useTab(tabs)
  usePageTitle(student ? fullName(student) : 'Students')
  if (!student) return <Navigate to="/app/students" replace />

  const summary = summarize(data, student)
  // What the Inbox shows when it is filtered to this student.
  const waiting = inboxSize(inbox)
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
            <Link to="/app/students" className="tap-link font-medium text-accent hover:underline">
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
                <Link to={`/app?student=${student.id}`} className="tap-link font-medium text-accent hover:underline">
                  Waiting for review ({waiting})
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            <Button onClick={() => setModal('link')}>Student link</Button>
            <Button variant="primary" onClick={() => setModal('log')}>
              Log a meeting
            </Button>
          </>
        }
      />
      <Tabs tabs={tabs} label={`${student.firstName}’s pages`} />

      <TabPanel tab={tab} label={tabs.find((t) => t.key === tab)?.label ?? ''}>
        {tab === 'overview' && <Overview student={student} />}
        {tab === 'meetings' && <MeetingsTab student={student} />}
        {tab === 'documents' && <DocumentsTab student={student} />}
        {tab === 'essays' && <EssaysTab student={student} />}
        {tab === 'reports' && <ReportsTab student={student} />}
        {tab === 'profile' && <ProfileTab student={student} />}
      </TabPanel>

      {modal === 'link' && <StudentLinkModal student={student} onClose={() => setModal(undefined)} />}
      {modal === 'log' && <LogMeetingModal studentId={student.id} onClose={() => setModal(undefined)} />}
    </>
  )
}
