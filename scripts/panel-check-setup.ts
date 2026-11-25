import './loadEnv.js'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { requireSettings } from './testAccounts.js'

requireSettings()
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const email = `platinum-panel-${randomUUID()}@example.com`
const password = randomUUID()
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (created.error || !created.data.user) throw new Error(created.error?.message ?? 'no user')
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const signedIn = await client.auth.signInWithPassword({ email, password })
if (signedIn.error || !signedIn.data.session) throw new Error(signedIn.error?.message ?? 'no session')
const firm = await client.rpc('create_firm', { name: 'Panel check firm', display_name: 'Counselor Panel' })
if (firm.error || !firm.data) throw new Error(firm.error?.message ?? 'no firm')
const kevinId = randomUUID()
const day = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const student = await client.from('students').insert({
  id: kevinId,
  firm_id: firm.data,
  first_name: 'Kevin',
  last_name: 'Zhang',
  grad_year: 2027,
  school: 'Invented High',
  city: 'Sample City',
  gpa: 3.78,
  majors: ['Computer Science'],
  interests: ['Robotics'],
  activities: [{ name: 'FRC Robotics Team 8841', role: 'Software lead', detail: 'Leads the programming subgroup.' }],
  onboarded_on: day(-120),
})
if (student.error) throw new Error(student.error.message)
const parent = await client.from('parents').insert({
  firm_id: firm.data,
  student_id: kevinId,
  name: 'Liu Min',
  relationship: 'Mother',
  language: 'zh-Hans',
  channel: 'wechat',
  email: 'liu.min@example.com',
  phone: '+14085550101',
  is_primary: true,
})
if (parent.error) throw new Error(parent.error.message)
const tasks = await client.from('tasks').insert({
  firm_id: firm.data,
  student_id: kevinId,
  title: 'Common App personal statement: third draft',
  category: 'essay',
  owner: 'student',
  due_date: day(-5),
  status: 'in_progress',
  source: 'counselor',
})
if (tasks.error) throw new Error(tasks.error.message)
const meeting = await client.from('meetings').insert({
  firm_id: firm.data,
  student_id: kevinId,
  title: 'Weekly check-in',
  date: day(2),
  time: '16:00',
  status: 'scheduled',
})
if (meeting.error) throw new Error(meeting.error.message)
writeFileSync('/tmp/platinum-panel-check.json', JSON.stringify({ email, password, userId: created.data.user.id, firmId: firm.data, studentId: kevinId }))
console.log(kevinId)
