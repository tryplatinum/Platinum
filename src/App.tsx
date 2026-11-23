// Every route in the app. Counselor screens live under /app (behind the fake
// sign-in); the student view lives under /student/:studentId.

import { Navigate, Route, Routes } from 'react-router-dom'
import { CounselorLayout, StudentLayout } from './components/Layout'
import CommandCenter from './screens/counselor/CommandCenter'
import EssayFeedback from './screens/counselor/EssayFeedback'
import MeetingReview from './screens/counselor/MeetingReview'
import Notifications from './screens/counselor/Notifications'
import ParentReports from './screens/counselor/ParentReports'
import PreMeetingBrief from './screens/counselor/PreMeetingBrief'
import ReadNotes from './screens/counselor/ReadNotes'
import Roster from './screens/counselor/Roster'
import SignIn from './screens/counselor/SignIn'
import StudentDetail from './screens/counselor/StudentDetail'
import { StudentHome, StudentProfile, StudentRecaps } from './screens/student/StudentScreens'

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />

      <Route path="/app" element={<CounselorLayout />}>
        <Route index element={<CommandCenter />} />
        <Route path="students" element={<Roster />} />
        <Route path="students/:studentId" element={<StudentDetail />} />
        <Route path="students/:studentId/meetings/:meetingId" element={<MeetingReview />} />
        <Route path="students/:studentId/meetings/:meetingId/brief" element={<PreMeetingBrief />} />
        <Route path="students/:studentId/documents/:docId" element={<EssayFeedback />} />
        <Route path="notes" element={<ReadNotes />} />
        <Route path="reports" element={<ParentReports />} />
        <Route path="notifications" element={<Notifications />} />
      </Route>

      <Route path="/student/:studentId" element={<StudentLayout />}>
        <Route index element={<StudentHome />} />
        <Route path="recaps" element={<StudentRecaps />} />
        <Route path="profile" element={<StudentProfile />} />
      </Route>

      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}
