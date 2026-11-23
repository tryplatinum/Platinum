// Every route in the app. Counselor screens live under /app (behind the
// stand-in sign-in); the student view lives under /student/:studentId.

import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { CounselorLayout, StudentLayout } from './components/Layout'
import CommandCenter from './screens/counselor/CommandCenter'
import Meetings from './screens/counselor/Meetings'
import Messages from './screens/counselor/Messages'
import SignIn from './screens/counselor/SignIn'
import StudentPage from './screens/counselor/StudentPage'
import Students from './screens/counselor/Students'
import { StudentHome, StudentProfile } from './screens/student/StudentView'

// ── Redirects from the v1 URLs, so old links and bookmarks keep working ──

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

      <Route path="/app" element={<CounselorLayout />}>
        <Route index element={<CommandCenter />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:studentId" element={<StudentPage />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="messages" element={<Messages />} />

        <Route path="students/:studentId/meetings/:meetingId" element={<MeetingRedirect />} />
        <Route path="students/:studentId/meetings/:meetingId/brief" element={<MeetingRedirect />} />
        <Route path="students/:studentId/documents/:docId" element={<EssayRedirect />} />
        <Route path="notes" element={<Navigate to="/app/meetings?log=1" replace />} />
        <Route path="reports" element={<Navigate to="/app/messages?kind=parent_report" replace />} />
        <Route path="notifications" element={<Navigate to="/app/messages?tab=queue" replace />} />
      </Route>

      <Route path="/student/:studentId" element={<StudentLayout />}>
        <Route index element={<StudentHome />} />
        <Route path="profile" element={<StudentProfile />} />
        <Route path="recaps" element={<StudentHomeRedirect />} />
      </Route>

      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}
