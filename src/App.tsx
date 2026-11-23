// Interim screen for Phase 1 of the design-v2 rebuild: the data layer is new,
// the interface is rebuilt in the phases that follow.

import { statusText, summarizeAll, fullName } from './lib/derive'
import { useData } from './store/store'

export default function App() {
  const data = useData()
  return (
    <ul className="p-8 text-sm text-ink">
      {summarizeAll(data).map((s) => (
        <li key={s.student.id}>
          {fullName(s.student)}: {s.progress.done}/{s.progress.total} tasks, {statusText(s)}
        </li>
      ))}
    </ul>
  )
}
