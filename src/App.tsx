// Every route in the app. Counselor screens live under /app (behind the
// stand-in sign-in); the student view lives under /student/:studentId.

import { Navigate, Route, Routes } from 'react-router-dom'
import { CounselorLayout, StudentLayout } from './components/Layout'
import { Card, Empty, PageHeader } from './components/ui'
import CommandCenter from './screens/counselor/CommandCenter'
import SignIn from './screens/counselor/SignIn'

/** Stands in for a screen that a later phase of the design-v2 rebuild adds. */
function Pending({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <Empty title="This screen is rebuilt in a later phase of the design-v2 branch." />
      </Card>
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/app" element={<CounselorLayout />}>
        <Route index element={<CommandCenter />} />
        <Route path="students" element={<Pending title="Students" />} />
        <Route path="students/:studentId" element={<Pending title="Student" />} />
        <Route path="meetings" element={<Pending title="Meetings" />} />
        <Route path="messages" element={<Pending title="Messages sent" />} />
      </Route>
      <Route path="/student/:studentId" element={<StudentLayout />}>
        <Route index element={<Pending title="Student view" />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}
