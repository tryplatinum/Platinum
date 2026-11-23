// Prepared "AI" content. Everything the simulated AI says is written here by
// hand, as functions of today's date so deadlines in the text stay current.
// services/ai.ts decides which fixture to return; the seed embeds a few of them
// so the demo opens with drafts already waiting.
//
// NOTE: The Chinese text was written by a non-native speaker. A native speaker
// must review it before a Mandarin-speaking parent or counselor sees it.

import { addDays, formatDate, formatDateZh, todayISO } from '../lib/dates'
import type { EssayFeedback, MeetingAI, Recap } from '../types'

/** Dates as offsets from today, in the three forms the text needs. */
export function dateCtx() {
  const today = todayISO()
  return {
    today,
    d: (offset: number) => addDays(today, offset),
    en: (offset: number) => formatDate(addDays(today, offset)),
    zh: (offset: number) => formatDateZh(addDays(today, offset)),
  }
}

// Stable ids the fixtures and the seed share.
export const IDS = {
  kevin: 's-kevin',
  kevinDad: 'p-kevin-dad',
  kevinMom: 'p-kevin-mom',
  kevinMeeting: 'm-kevin-latest',
  kevinEssay: 'doc-kevin-ps',
  daniel: 's-daniel',
  danielMom: 'p-daniel-mom',
  danielMeeting: 'm-daniel-latest',
  sophia: 's-sophia',
  sophiaMom: 'p-sophia-mom',
  sophiaEssay: 'doc-sophia-piq',
  mia: 's-mia',
  miaMom: 'p-mia-mom',
} as const

// ── Meeting drafts ──────────────────────────────────────────────────────────

/** Kevin Zhang's latest meeting: the centrepiece of the demo. */
export function kevinMeetingDrafts(): { ai: MeetingAI; recap: Recap } {
  const { d, en, zh } = dateCtx()
  return {
    ai: {
      notes: [
        'Kevin confirmed NYU (Tandon, Computer Science) as his ED2 choice after the campus visit. Mom agrees. Dad wants to see the cost estimate before committing.',
        'Personal statement is still on draft 2. The robot-failure opening works; the middle lists achievements instead of showing how he changed. He agreed to rebuild it around the regional qualifier.',
        `UC application: PIQ 1 and 2 are final. PIQ 3 and 4 are not started and the UC deadline is ${en(6)}. This is the most urgent item.`,
        'He retook the SAT in October: 1490 → 1530 (Math 800). The new score is not in his profile and has not been sent to colleges.',
        'New activity since September: he teaches a free Saturday Python class for middle schoolers at the public library.',
        'CSS Profile is blocked on Dad uploading the 2025 tax return. NYU ED2 needs it by the application deadline.',
        'Mr. Alvarez (AP Physics) has not confirmed the recommendation letter. Sarah to follow up.',
      ],
      draftTasks: [
        {
          id: 'dt-kevin-1',
          title: 'Outline “Why NYU” with three specifics from the campus visit',
          detail: 'Bullet points only. Name the lab, the course and the person you talked about in the meeting.',
          category: 'essay',
          owner: 'student',
          dueDate: d(3),
          review: 'pending',
        },
        {
          id: 'dt-kevin-2',
          title: 'Send October SAT score (1530) to NYU, CMU and Georgia Tech',
          category: 'testing',
          owner: 'student',
          dueDate: d(4),
          review: 'pending',
        },
        {
          id: 'dt-kevin-3',
          title: 'Block 30 minutes of writing time Mon–Thu and share the calendar with Sarah',
          category: 'planning',
          owner: 'student',
          dueDate: d(1),
          review: 'pending',
        },
        {
          id: 'dt-kevin-4',
          title: 'Review the NYU net price estimate and confirm the ED2 commitment',
          detail: 'ED2 is binding. Sarah will send the estimate; the family decides together.',
          category: 'financial',
          owner: 'parent',
          ownerParentId: IDS.kevinDad,
          dueDate: d(5),
          review: 'pending',
        },
        {
          id: 'dt-kevin-5',
          title: 'Follow up with Mr. Alvarez on the recommendation letter',
          category: 'recommendation',
          owner: 'counselor',
          dueDate: d(2),
          review: 'pending',
        },
      ],
      parentUpdates: [
        {
          id: 'pu-kevin-dad',
          parentId: IDS.kevinDad,
          review: 'pending',
          bodyEn: `Hello Mr. Zhang, this is Sarah, Kevin's counselor. Here is where things stand after yesterday's meeting.

1. ED2 choice: Kevin has chosen NYU (Tandon School of Engineering, Computer Science) for Early Decision 2. The deadline is ${en(12)}. ED2 is binding, so I will send you NYU's cost estimate this week to review before we commit.
2. Essays: his main essay is on its second draft and needs restructuring. The University of California application still needs two short essays, and its deadline is ${en(6)}. That is the most urgent item right now.
3. Testing: Kevin scored 1530 on the October SAT (800 in Math), 40 points higher than before. He should be proud of that.
4. Where I need your help: the CSS Profile financial aid form is still missing your 2025 tax return. NYU needs it by the ED2 deadline. Could you upload it by ${en(3)}?

Overall Kevin is behind where we planned to be, and the next two weeks matter. I am checking in with him daily on the essays and will keep you posted. Thank you.`,
          bodyLocal: `张先生您好，我是凯文的升学顾问 Sarah。跟您同步一下昨天面谈后的情况。

1. ED2 志愿：凯文已经决定把纽约大学（NYU）工程学院的计算机专业作为 ED2 志愿，截止日期是${zh(12)}。ED2 录取后必须入读，所以这周我会先把 NYU 的费用估算发给您，您看过之后我们再最终确认。
2. 文书进度：主文书目前是第二稿，结构还需要调整。加州大学（UC）的申请还差两篇短文书，截止日期是${zh(6)}，这是眼下最紧急的一项。
3. 标化成绩：凯文 10 月的 SAT 考了 1530 分（数学 800 分），比上次提高了 40 分，值得肯定。
4. 需要您协助：CSS Profile 助学金申请还缺 2025 年的报税表，NYU 要求在 ED2 截止前提交。麻烦您在${zh(3)}前上传。

整体来看，凯文的进度比原计划落后一些，接下来两周比较关键。文书方面我会每天跟进，有新的情况会及时跟您沟通。谢谢！`,
        },
        {
          id: 'pu-kevin-mom',
          parentId: IDS.kevinMom,
          review: 'pending',
          bodyEn: `Hello Ms. Liu, this is Sarah. A short update after yesterday's meeting with Kevin.

Kevin has chosen NYU for Early Decision 2 (deadline ${en(12)}). His October SAT came back at 1530, up 40 points. The University of California application is due ${en(6)} and still needs two short essays, so that is his focus this week.

I have asked Mr. Zhang to upload the 2025 tax return for the financial aid form by ${en(3)}. If you are able to remind him at home, that would help a lot. Thank you.`,
          bodyLocal: `刘女士您好，我是 Sarah。跟您简单同步一下昨天和凯文面谈的情况。

凯文已经确定把纽约大学（NYU）作为 ED2 志愿，截止日期是${zh(12)}。10 月的 SAT 成绩出来了，1530 分，比上次提高了 40 分。加州大学（UC）的申请${zh(6)}截止，目前还差两篇短文书，这周他会集中精力完成。

另外，助学金申请需要 2025 年的报税表，我已经请张先生在${zh(3)}前上传。方便的话也麻烦您在家提醒一下，非常感谢！`,
        },
      ],
      profileChanges: [
        {
          id: 'pc-kevin-1',
          label: 'SAT score',
          from: '1490',
          to: '1530',
          evidence: '“I got my October score back, 1530. 800 on math.”',
          patch: { kind: 'score', field: 'sat', value: 1530 },
          review: 'pending',
        },
        {
          id: 'pc-kevin-2',
          label: 'New activity',
          from: 'Not listed',
          to: 'Saturday Python Class, Founder and instructor',
          evidence: '“Since September I’ve been teaching Python to middle schoolers at the library on Saturdays.”',
          patch: {
            kind: 'addActivity',
            activity: {
              id: 'act-kevin-python',
              name: 'Saturday Python Class (public library)',
              role: 'Founder and instructor',
              detail: 'Free weekly class for middle schoolers, about 12 students, since September.',
            },
          },
          review: 'pending',
        },
        {
          id: 'pc-kevin-3',
          label: 'Intended majors',
          from: 'Computer Science, Data Science',
          to: 'Computer Science, Robotics',
          evidence: '“Honestly data science was my dad’s idea. I want to do robotics.”',
          patch: { kind: 'setMajors', value: ['Computer Science', 'Robotics'] },
          review: 'pending',
        },
      ],
    },
    recap: {
      review: 'pending',
      summary: `Good session, Kevin. You locked in NYU for ED2 and your 1530 is a real win. The UC application is the fire: it is due ${en(6)} and PIQ 3 and 4 are not started. Do those before anything else. For the personal statement, keep your opening and rebuild the middle around the regional qualifier, the way we talked about.`,
      nextSteps: [
        `Draft UC PIQ 3 and 4 first. The UC deadline is ${en(6)}.`,
        'Block 30 minutes of writing time Monday to Thursday and share the calendar with me.',
        `Outline “Why NYU” with three specifics from your visit by ${en(3)}.`,
        `Send your 1530 to NYU, CMU and Georgia Tech by ${en(4)}.`,
        'Personal statement draft 3: keep the opening, cut the list of achievements, show what changed after the qualifier.',
      ],
    },
  }
}

/** Daniel Kim's latest meeting. Returned live by draftFromMeeting, not pre-seeded. */
export function danielMeetingDrafts(): { ai: MeetingAI; recap: Recap } {
  const { d, en } = dateCtx()
  return {
    ai: {
      notes: [
        'Daniel was admitted to Indiana (Kelley direct admit) and Arizona State. He is relieved, and less motivated on the UC essays as a result.',
        `UC application is due ${en(6)}. PIQ 4 has no draft and the activities list is missing hours.`,
        'He wants to write PIQ 4 about his sneaker resale business. Good topic; he needs numbers and one specific customer story.',
        'December ACT: he took a practice test and scored 32, up from 30. Registered for the real test.',
        'USC supplement not started. Agreed it waits until the UC application is in.',
      ],
      draftTasks: [
        {
          id: 'dt-daniel-1',
          title: 'Draft UC PIQ 4 on the resale business, with real numbers and one customer story',
          category: 'essay',
          owner: 'student',
          dueDate: d(2),
          review: 'pending',
        },
        {
          id: 'dt-daniel-2',
          title: 'Add hours per week and weeks per year to every UC activity',
          category: 'application',
          owner: 'student',
          dueDate: d(1),
          review: 'pending',
        },
        {
          id: 'dt-daniel-3',
          title: 'Compare Kelley and ASU scholarship letters with Daniel',
          category: 'financial',
          owner: 'parent',
          ownerParentId: IDS.danielMom,
          dueDate: d(7),
          review: 'pending',
        },
      ],
      parentUpdates: [
        {
          id: 'pu-daniel-mom',
          parentId: IDS.danielMom,
          review: 'pending',
          bodyEn: `Hi Grace, Sarah here with a quick update on Daniel. Great news first: he has been admitted to Indiana (Kelley School of Business, direct admit) and Arizona State. The University of California application is due ${en(6)} and he still has one essay and his activities list to finish, so that is the priority this week. When the scholarship letters arrive, could you sit down with him and compare the two offers by ${en(7)}? Thanks!`,
        },
      ],
      profileChanges: [
        {
          id: 'pc-daniel-1',
          label: 'New activity detail',
          from: 'Not listed',
          to: 'Sneaker resale business, Founder',
          evidence: '“I’ve done about four thousand in sales since last summer.”',
          patch: {
            kind: 'addActivity',
            activity: {
              id: 'act-daniel-resale',
              name: 'Sneaker resale business',
              role: 'Founder',
              detail: 'About $4,000 in sales since last summer; sources, authenticates and ships himself.',
            },
          },
          review: 'pending',
        },
      ],
    },
    recap: {
      review: 'pending',
      summary: `Congratulations again on Kelley and ASU. Those are real options, and they are also the reason to finish strong on the UCs. The UC application is due ${en(6)}.`,
      nextSteps: [
        `Add hours to your UC activities list by ${en(1)}.`,
        `Draft PIQ 4 on the resale business by ${en(2)}: real numbers, one customer story.`,
        'USC supplement waits until the UC application is submitted.',
      ],
    },
  }
}

/** Fallback when a meeting has no prepared drafts. */
export function genericMeetingDrafts(firstName: string): { ai: MeetingAI; recap: Recap } {
  const { d } = dateCtx()
  return {
    ai: {
      notes: [
        `Reviewed open tasks with ${firstName} and agreed priorities for the next two weeks.`,
        'No changes to the college list.',
      ],
      draftTasks: [
        {
          id: `dt-generic-${Date.now()}`,
          title: 'Send Sarah an update on the top-priority task',
          category: 'planning',
          owner: 'student',
          dueDate: d(3),
          review: 'pending',
        },
      ],
      parentUpdates: [],
      profileChanges: [],
    },
    recap: {
      review: 'pending',
      summary: `Thanks for today, ${firstName}. We went through your open tasks and agreed what comes first.`,
      nextSteps: ['Work on your top-priority task and send me an update in three days.'],
    },
  }
}

// ── Reading a counselor's own notes ─────────────────────────────────────────

export function sampleCounselorNote(): string {
  const { en } = dateCtx()
  return `Sophia — 45 min, video

- PIQ 2 still reads like a résumé. She'll rewrite it around the closing-shift story at the restaurant, by ${en(3)}
- Cal State Apply: SDSU + CSULB. She needs to enter A-G coursework, wants to finish this weekend
- Elena hasn't done the FAFSA parent section, locked out of FSA ID. I'll send the reset link and walk her through by phone tomorrow
- LMU: decided to apply RD. Needs a why-LMU outline before our next meeting
- Rec letter: nervous about asking Coach Rivera. She'll ask in person in two days`
}

export function sampleNoteResult(): { summary: string; tasks: MeetingAI['draftTasks'] } {
  const { d } = dateCtx()
  return {
    summary:
      'Six assignments found: four for Sophia, one for her mother and one for you. Due dates come from the note where it gives one; the rest are set before the next meeting.',
    tasks: [
      {
        id: 'nt-1',
        title: 'Rewrite UC PIQ 2 around the closing-shift story',
        category: 'essay',
        owner: 'student',
        dueDate: d(3),
        review: 'pending',
      },
      {
        id: 'nt-2',
        title: 'Enter A–G coursework in Cal State Apply (SDSU, CSULB)',
        category: 'application',
        owner: 'student',
        dueDate: d(2),
        review: 'pending',
      },
      {
        id: 'nt-3',
        title: 'Reset FSA ID and finish the FAFSA parent section',
        category: 'financial',
        owner: 'parent',
        ownerParentId: IDS.sophiaMom,
        dueDate: d(5),
        review: 'pending',
      },
      {
        id: 'nt-4',
        title: 'Send Elena the FSA ID reset link and walk her through it by phone',
        category: 'financial',
        owner: 'counselor',
        dueDate: d(1),
        review: 'pending',
      },
      {
        id: 'nt-5',
        title: 'Outline the “Why LMU” supplement',
        category: 'essay',
        owner: 'student',
        dueDate: d(5),
        review: 'pending',
      },
      {
        id: 'nt-6',
        title: 'Ask Coach Rivera for a recommendation letter, in person',
        category: 'recommendation',
        owner: 'student',
        dueDate: d(2),
        review: 'pending',
      },
    ],
  }
}

// ── Essay feedback ──────────────────────────────────────────────────────────

export const KEVIN_ESSAY_PROMPT =
  'Common App prompt 2: The lessons we take from obstacles we encounter can be fundamental to later success. Recount a time when you faced a challenge, setback, or failure. How did it affect you, and what did you learn from the experience?'

export const KEVIN_ESSAY_TEXT = `The robot stopped moving eleven seconds into the match. I knew before anyone else did, because I wrote the code that was supposed to keep it moving.

I joined the robotics team in ninth grade. In tenth grade I became software lead. I taught myself computer vision, reached Gold in USACO, and built a path-planning library that three other teams now use. Junior year I led six programmers and we won the Innovation in Control award at our regional. I also served as treasurer of the math club and tutored students in Python.

At the regional qualifier, a null pointer in my autonomous routine froze the robot in front of four hundred people. We lost the match and did not qualify. It was the worst day of my high school career.

After that I learned that testing matters and that I should listen to my teammates more. I am now a better leader and a better programmer, and I will bring these lessons to college.`

export const SOPHIA_ESSAY_PROMPT =
  'UC Personal Insight Question 2: Every person has a creative side, and it can be expressed in many ways: problem solving, original and innovative thinking, and artistically, to name a few. Describe how you express your creative side.'

export const SOPHIA_ESSAY_TEXT = `I express my creative side in many ways. I am captain of the varsity soccer team, where I design set pieces. I tutor freshmen in algebra and come up with new ways to explain things. I also work at my family's restaurant on weekends.

On closing shifts I am usually alone at the front with whatever is left in the kitchen. One night a family came in ten minutes before closing and their daughter could not eat gluten or dairy. We had almost nothing left. I made her a plate out of grilled chicken, rice, and the salsa my grandmother makes, and she ate all of it.

Creativity is important to me and I will continue to be creative in college.`

export function kevinEssayFeedback(): EssayFeedback {
  return {
    review: 'pending',
    generatedOn: todayISO(),
    overall:
      'The opening is specific and the essay picks the right moment. The draft does not yet answer the second half of the prompt: the reader sees what happened, but not how Kevin changed because of it.',
    strengths: [
      'The first two sentences put the reader in the moment and show ownership without announcing it.',
      'The failure is concrete: a null pointer, eleven seconds, four hundred people.',
    ],
    points: [
      {
        area: 'Structure',
        observation:
          'Paragraph 2 leaves the story to list achievements. The match is set up in paragraph 1 and does not return until paragraph 3.',
        question:
          'What does the reader need to know about you before the robot stops? What could move to the activities list instead?',
      },
      {
        area: 'Clarity',
        observation:
          '“I learned that testing matters and that I should listen to my teammates more” states the lesson in general terms. No teammate appears anywhere in the essay.',
        question:
          'Who told you something you did not listen to? What exactly did they say, and what did you do in the week after the qualifier?',
      },
      {
        area: 'Answers the prompt',
        observation:
          'The prompt asks how the setback affected you and what you learned. That part is two sentences out of the whole essay.',
        question: 'What do you do differently now that someone on your team would notice?',
      },
    ],
  }
}

export function sophiaEssayFeedback(): EssayFeedback {
  return {
    review: 'pending',
    generatedOn: todayISO(),
    overall:
      'The closing-shift story in the middle is the essay. The first and last paragraphs talk about creativity in general and could belong to anyone.',
    strengths: [
      'The plate for the girl who could not eat gluten or dairy is a real, small, specific act of problem solving.',
      'The grandmother’s salsa is the kind of detail only Sophia could write.',
    ],
    points: [
      {
        area: 'Structure',
        observation: 'The first paragraph lists three activities before the story starts, so the essay reads like a résumé for its first third.',
        question: 'What happens if the essay opens ten minutes before closing?',
      },
      {
        area: 'Clarity',
        observation: '“I express my creative side in many ways” and “Creativity is important to me” tell the reader the theme without adding information.',
        question: 'What were you thinking as you looked at what was left in the kitchen? What did you try first?',
      },
      {
        area: 'Answers the prompt',
        observation: 'The prompt asks how you express your creative side. One night shows it once; the reader cannot yet tell whether this is a habit.',
        question: 'Where else do you solve problems with whatever is at hand, on the field or tutoring?',
      },
    ],
  }
}

export function genericEssayFeedback(): EssayFeedback {
  return {
    review: 'pending',
    generatedOn: todayISO(),
    overall:
      'The draft has a clear topic. The strongest material is the specific moments; the general statements around them carry less.',
    strengths: ['The topic is personal and the voice sounds like a student, not a brochure.'],
    points: [
      {
        area: 'Structure',
        observation: 'The opening takes several sentences to reach the main story.',
        question: 'Which sentence would you start with if you could only keep one from the first paragraph?',
      },
      {
        area: 'Clarity',
        observation: 'Several sentences state a quality (hard-working, curious) without an example next to them.',
        question: 'For each quality you name, what is one thing you did that shows it?',
      },
      {
        area: 'Answers the prompt',
        observation: 'The final paragraph restates the prompt without adding a new thought.',
        question: 'What is different about you now, compared with before the events in this essay?',
      },
    ],
  }
}
