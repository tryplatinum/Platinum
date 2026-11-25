// Every route in the app.
//   /app/…            counselor screens, behind sign-in and a firm (RequireFirm)
//   /app/styleguide   every shared component in each state; not in the navigation
//   /student/:id      the counselor's preview of a student's page, also behind sign-in
//   /s/:token         the student's own page, opened from their secret link, no login
//   /phone-setup      opened on the counselor's own phone from the QR code in Settings, no login

import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { CounselorLayout, StudentLayout } from './components/Layout'
import { RequireFirm } from './components/RequireFirm'
import Activity from './screens/counselor/Activity'
import Inbox from './screens/counselor/Approvals'
import Documents from './screens/counselor/Documents'
import Meetings from './screens/counselor/Meetings'
import Messages from './screens/counselor/Messages'
import PhoneSetup from './screens/PhoneSetup'
import Settings from './screens/counselor/Settings'
import SignIn, { FirmSetup, ResetPassword } from './screens/counselor/SignIn'
import StudentPage from './screens/counselor/StudentPage'
import Students from './screens/counselor/Students'
import { StudentLinkLayout } from './screens/student/StudentLinkLayout'
import { StudentHome, StudentProfile } from './screens/student/StudentView'
import ListDraft from './screens/counselor/ListDraft'
import Styleguide from './screens/counselor/Styleguide'

// ── Redirects from earlier URLs, so old links and bookmarks keep working ──

/** A meeting or its brief now opens in the Meetings area with the student selected. */
function MeetingRedirect() {
  const { studentId } = useParams()
  return <Navigate to={`/app/meetings?student=${studentId}`} replace />
}

/** Essay feedback now opens in the student's Essays tab. */
function EssayRedirect() {
  const { studentId, docId } = useParams()
  return <Navigate to={`/app/students/${studentId}?tab=essays&essay=${docId}`} replace />
}

function StudentHomeRedirect() {
  const { studentId } = useParams()
  return <Navigate to={`/student/${studentId}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/setup" element={<FirmSetup />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/phone-setup" element={<PhoneSetup />} />

      <Route path="/s/:token" element={<StudentLinkLayout />}>
        <Route index element={<StudentHome />} />
      </Route>

      <Route element={<RequireFirm />}>
        <Route path="/app" element={<CounselorLayout />}>
          <Route index element={<Inbox />} />
          <Route path="activity" element={<Activity />} />
          <Route path="students" element={<Students />} />
          <Route path="students/:studentId" element={<StudentPage />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="messages" element={<Messages />} />
          <Route path="documents" element={<Documents />} />
          <Route path="settings" element={<Settings />} />

          <Route path="students/:studentId/meetings/:meetingId" element={<MeetingRedirect />} />
          <Route path="students/:studentId/meetings/:meetingId/brief" element={<MeetingRedirect />} />
          <Route path="students/:studentId/documents/:docId" element={<EssayRedirect />} />
          <Route path="overview" element={<Navigate to="/app/students" replace />} />
          <Route path="notes" element={<Navigate to="/app/meetings?log=1" replace />} />
          <Route path="reports" element={<Navigate to="/app/messages?kind=parent_report" replace />} />
          <Route path="notifications" element={<Navigate to="/app/messages?tab=queue" replace />} />
          <Route path="students/:studentId/list-draft" element={<ListDraft />} />
          {/* The review surface for brand changes. Not in the navigation. */}
          <Route path="styleguide" element={<Styleguide />} />
        </Route>

        <Route path="/student/:studentId" element={<StudentLayout />}>
          <Route index element={<StudentHome />} />
          <Route path="profile" element={<StudentProfile />} />
          <Route path="recaps" element={<StudentHomeRedirect />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}
