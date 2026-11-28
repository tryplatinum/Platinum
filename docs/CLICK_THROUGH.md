# Click-through

A founder's script for a real test project (`docs/TEST_PROJECT.md`), about 20 minutes. Each step says what should be on screen afterwards. Where a step fails, write down the step number and what you saw instead.

Before you start: `npm run dev` is running against the **test** project, `ALLOW_LOG_TRANSPORT=true`, your own address is in `SEND_ALLOWLIST`, and `ANTHROPIC_API_KEY` is set (steps 4 and 11 to 13 call the model). Use two browser windows: a normal one for the owner and a private one for step 14.

## Start

1. **Sign up.** Open `/signup`. Fill in your name, an email you can read, a password of 8 or more characters, and a firm name. Press Create firm.
   *Afterwards:* the Today page, with your firm's name at the bottom of the sidebar and "Firm" above Settings. (With "Confirm email" on you first see "Confirm your email"; open the link in the same browser, sign in, and you land on Today.)
2. **Add a student.** Students → Add student. First name, last name, a graduation year that makes them a junior or senior, and an email. Save.
   *Afterwards:* the student's page, with the tabs Overview, Meetings, Documents, Essays, Parent reports, Profile.
3. **Add one parent.** Profile → Parents → Add parent. Name, relationship, language English, channel Email, and **your own allowlisted address**. Save.
   *Afterwards:* the parent is listed with "Email" beside the name.

## A meeting, and what it drafts

4. **Log a meeting with notes.** On the student's page press Log a meeting. Title "Check-in", today's date, and paste four or five lines of notes that name a task, a due date and a decision. Save.
   *Afterwards:* "AI is drafting…", then a review with a recap, draft tasks, and a parent update. The sidebar's Inbox badge goes up.
5. **Approve the drafts.** Open Inbox. Approve the recap and one task.
   *Afterwards:* each row leaves the list; the task is on the student's Overview.
6. **Approve the parent update, then Undo it.** Approve it. A toast counts down from 10 with Undo. Press Undo.
   *Afterwards:* the toast says it was undone and the draft is back in the Inbox.
7. **Approve it again and let it go.** Approve, and wait for the countdown to finish.
   *Afterwards:* the toast closes and the row is gone from the Inbox.
8. **See it in Messages and Activity.** Open Messages, then Activity.
   *Afterwards:* Messages lists the update as Sent, to the parent, by email. Activity has "Approved a parent report…", "Cancelled a parent report…" (from step 6), and "Sent a parent report…". The server's terminal has one `[transport:log]` line with a masked address and no message text.

## Templates and scheduling

9. **Assign a task plan.** Templates → New → Task plan. Two tasks, one "14 days after it is assigned". Save. On the student's Overview press From a template, choose it, and Add.
   *Afterwards:* the two tasks are on the student's list with the dates the window showed before you pressed Add.
10. **Send a template message.** Templates → New → Message, to the parent, English body with `{{student_first_name}}`. Save. On Students, tick the student, Assign a template, choose the message. Open Inbox and approve it.
    *Afterwards:* a draft with the student's name filled in; after the hold it is in Messages as Sent.
11. **Schedule a meeting.** Meetings → Schedule. The student, a title, a date next week, a time. Save.
    *Afterwards:* the meeting is on the calendar view and under "Next meeting" on the student's page. (With Google Calendar on, one event appears on your calendar with no guests.)

## The assistant

Open the assistant with the Assistant button or Cmd/Ctrl+J. On a student's page it is that student's thread; anywhere else it is the general one.

12. **Ask it to read.** From Today, ask "What do I have to review?"
    *Afterwards:* a short answer that matches the Inbox, with chips under it naming the records it read. Nothing new in the Inbox.
13. **Ask it to draft.** On the student's page, ask "Draft a reminder to their parent about the task due soonest."
    *Afterwards:* one or two sentences ending "You can approve it below.", and a card under the reply with the message, the parent's name and the channel. Press Approve on the card in the chat.
    *Afterwards:* the Undo countdown, then the message in Messages as Sent. The card in the chat says Approved.
14. **Ask it to schedule.** Still on the student, ask "Schedule our next meeting for next week."
    *Afterwards:* a card with two or three times to choose from. Choose one and press Approve.
    *Afterwards:* exactly one new meeting on Meetings at the time you chose. No meeting exists for the times you did not choose.

## People

15. **Invite a counselor.** Firm → Invitations. An email, Make invitation link, Copy. Paste the link into the private window, make a password with that address, give a name, Join.
    *Afterwards:* the private window is on Today with no "Firm" link in the sidebar. In the owner's window, Firm → Team lists them as Counselor.
16. **Open the student link.** On the student's page press Student link → Create link → Copy. Open it in the private window (sign out there first, or use a third window).
    *Afterwards:* the student's own page: their tasks, next meeting, deadlines and the approved recap. The address bar shows `/s` with nothing after it. Tick a task; back in the owner's window the task shows as done by the student after you switch away and back.

## If something is off

- A send that comes back with "Your last change was undone" is the database refusing it: read the sentence after it.
- A message that stays "Queued" past 10 seconds means `/api/dispatch` did not run or refused the address: check `SEND_ALLOWLIST` and the terminal.
- The assistant answering "Daily assistant limit reached" is the firm's budget (`AGENT_DAILY_LIMIT`).
