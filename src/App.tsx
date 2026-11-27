// Every route in the app.
//   /                 the landing page for a signed-out visitor; a signed-in one goes to their home
//   /signin, /signup, /setup, /start, /reset-password   signing in, for all three kinds of account
//   /join#<secret>    where an invitation link lands
//   /me               a student's own page, with a student sign-in
//   /app/…            counselor screens, behind sign-in and a firm (RequireFirm)
//   /app/styleguide   every shared component in each state; not in the navigation
//   /student/:id      the counselor's preview of a student's page, also behind sign-in
//   /s#<secret>       the student's own page, opened from their secret link, no login (/s/<secret> still opens)
//   /phone-setup      opened on the counselor's own phone from the QR code in Settings, no login

import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { CounselorLayout, StudentLayout } from './components/Layout'
import { RequireFirm, RequireOwner, Splash } from './components/RequireFirm'
import { homeOf } from './store/session'
import { useStore } from './store/store'
import Activity from './screens/counselor/Activity'
import Inbox from './screens/counselor/Approvals'
import Documents from './screens/counselor/Documents'
import Firm from './screens/counselor/Firm'
import Meetings from './screens/counselor/Meetings'
import Messages from './screens/counselor/Messages'
import PhoneSetup from './screens/PhoneSetup'
import Settings from './screens/counselor/Settings'
import Templates from './screens/counselor/Templates'
import SignIn, { FirmSetup, ResetPassword, SignUp, Start } from './screens/counselor/SignIn'
import Join from './screens/Join'
import { StudentAccount, StudentAccountLayout } from './screens/student/Me'
import StudentPage from './screens/counselor/StudentPage'
import Students from './screens/counselor/Students'
import Today from './screens/counselor/Today'
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

// The landing page is its own chunk. Here it is only for a visitor the entry took for signed in and who is not.
const Landing = lazy(() => import('./landing/Landing'))

/** "/": a signed-in visitor goes to their home; anyone else sees the landing page. */
function Front() {
  const account = useStore((s) => s.account)
  const home = homeOf(account)
  if (home) return <Navigate to={home} replace />
  if (account.status === 'loading') return <Splash>{null}</Splash>
  // Signed in, but the account could not be looked up: the workspace's own screen says so and offers to try again.
  if (account.status === 'error') return <Navigate to="/app/today" replace />
  return (
    <Suspense fallback={<Splash>{null}</Splash>}>
      <Landing />
    </Suspense>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Front />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/setup" element={<FirmSetup />} />
      <Route path="/start" element={<Start />} />
      <Route path="/join" element={<Join />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/phone-setup" element={<PhoneSetup />} />

      {/* /s#<secret> is the address a new link has. /s/<secret> is what older links have; it still opens. */}
      <Route path="/s" element={<StudentLinkLayout />}>
        <Route index element={<StudentHome />} />
      </Route>
      <Route path="/s/:token" element={<StudentLinkLayout />}>
        <Route index element={<StudentHome />} />
      </Route>

      {/* A student's sign-in: the same screens as the link, fed by their session. */}
      <Route path="/me" element={<StudentAccountLayout />}>
        <Route index element={<StudentHome />} />
        <Route path="account" element={<StudentAccount />} />
      </Route>

      <Route element={<RequireFirm />}>
        <Route path="/app" element={<CounselorLayout />}>
          {/* The Inbox keeps the address it has always had; Today is where the day starts. */}
          <Route index element={<Inbox />} />
          <Route path="today" element={<Today />} />
          <Route path="activity" element={<Activity />} />
          <Route path="students" element={<Students />} />
          <Route path="students/:studentId" element={<StudentPage />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="messages" element={<Messages />} />
          <Route path="documents" element={<Documents />} />
          <Route path="templates" element={<Templates />} />
          <Route path="settings" element={<Settings />} />
          {/* Owners only. A counselor who opens it goes to Today; the server refuses them in any case. */}
          <Route element={<RequireOwner />}>
            <Route path="firm" element={<Firm />} />
          </Route>

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

      <Route path="*" element={<Navigate to="/app/today" replace />} />
    </Routes>
  )
}
