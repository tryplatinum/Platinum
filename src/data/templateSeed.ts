// The invented templates that come with the sample caseload, so the Templates
// page is not empty in the demo. Every name and sentence here is made up.

import type { Template } from '../types'

const after = (days: number) => ({ from: 'after_assigned' as const, days })
const before = (days: number) => ({ from: 'before_date' as const, days })

export function sampleTemplates(): Template[] {
  return [
    {
      id: 'tpl-onboarding',
      kind: 'task_plan',
      name: 'Onboarding a new junior',
      archived: false,
      content: {
        tasks: [
          { title: 'Send your transcript and current class schedule', owner: 'student', due: after(7) },
          { title: 'Fill in the activities list worksheet', owner: 'student', due: after(14), note: 'Everything since ninth grade, with hours a week and weeks a year.' },
          { title: 'Share last year’s tax return for the aid estimate', owner: 'parent', due: after(21) },
          { title: 'Build a first college list of fifteen', owner: 'counselor', due: after(28) },
          { title: 'Pick two teachers to ask for recommendations', owner: 'student', due: after(35) },
        ],
      },
    },
    {
      id: 'tpl-uc-six-weeks',
      kind: 'task_plan',
      name: 'UC application, last six weeks',
      archived: false,
      content: {
        dateLabel: 'UC deadline',
        tasks: [
          { title: 'Choose four personal insight questions', owner: 'student', due: before(42) },
          { title: 'First drafts of all four answers', owner: 'student', due: before(28) },
          { title: 'Activities and awards section complete', owner: 'student', due: before(21) },
          { title: 'Read and mark up the four drafts', owner: 'counselor', due: before(18) },
          { title: 'Final drafts of all four answers', owner: 'student', due: before(10) },
          { title: 'Pay the application fees', owner: 'parent', due: before(5) },
          { title: 'Submit the UC application', owner: 'student', due: before(2), note: 'Two days early, never on the last night.' },
        ],
      },
    },
    {
      id: 'tpl-rec-letter',
      kind: 'task_plan',
      name: 'Asking for a recommendation letter',
      archived: false,
      content: {
        dateLabel: 'First application deadline',
        tasks: [
          { title: 'Ask the teacher in person', owner: 'student', due: before(56) },
          { title: 'Send the teacher your brag sheet', owner: 'student', due: before(49) },
          { title: 'Add the teacher as a recommender in the application', owner: 'student', due: before(42) },
          { title: 'Check the letter has been uploaded', owner: 'counselor', due: before(14) },
          { title: 'Write the teacher a thank-you note', owner: 'student', due: before(7) },
        ],
      },
    },
    {
      id: 'tpl-welcome',
      kind: 'message',
      name: 'Welcome to the family',
      archived: false,
      content: {
        to: 'parent',
        subject: 'Welcome, and what happens next',
        bodies: {
          en: 'Hello {{parent_name}}, this is {{counselor_name}} from {{firm_name}}. I am glad to be working with {{student_first_name}}. Over the next two weeks I will gather transcripts and activities and build a first plan. You will hear from me after each meeting, and you can write to me here at any time.',
          'zh-Hans': '{{parent_name}}您好，我是{{firm_name}}的{{counselor_name}}，很高兴接下来能陪{{student_first_name}}一起准备申请。未来两周我会先整理成绩单和活动经历，拟出初步规划。每次会谈后我都会向您说明进度，有任何问题也欢迎随时在这里联系我。',
          'zh-Hant': '{{parent_name}}您好，我是{{firm_name}}的{{counselor_name}}，很高興接下來能陪{{student_first_name}}一起準備申請。未來兩週我會先整理成績單和活動經歷，擬出初步規劃。每次會談後我都會向您說明進度，有任何問題也歡迎隨時在這裡聯絡我。',
        },
      },
    },
    {
      id: 'tpl-first-meeting',
      kind: 'message',
      name: 'Before your first meeting',
      archived: false,
      content: {
        to: 'student',
        subject: 'Before we meet',
        bodies: {
          en: 'Hi {{student_first_name}}, it’s {{counselor_name}}. We meet on {{next_meeting_date}}. Before then, jot down three things you like doing outside class and one college you are curious about. Your tasks are here: {{student_link}}',
        },
      },
    },
    {
      id: 'tpl-essay-late',
      kind: 'message',
      name: 'Essay draft is late',
      archived: false,
      content: {
        to: 'student',
        subject: 'Your essay draft',
        bodies: {
          en: 'Hi {{student_first_name}}, your essay draft was due {{due_date}} and I have not seen it yet. A rough page is fine: send what you have and we will fix it together. {{student_link}}',
        },
      },
    },
    {
      id: 'tpl-brainstorm',
      kind: 'handout',
      name: 'Essay brainstorm sheet',
      archived: false,
      content: {
        source: 'text',
        text: 'Essay brainstorm\n\nAnswer each in two or three sentences. Do not polish.\n\n1. A time you changed your mind about something that mattered to you.\n2. Something you taught yourself, and how you went about it.\n3. A place where you lose track of time. What are you doing there?\n4. A problem you would work on even if nobody asked you to.\n5. What would your closest friend say you are stubborn about?\n\nCircle the two answers you most want to keep writing about.',
      },
    },
    {
      id: 'tpl-brag-sheet',
      kind: 'handout',
      name: 'Brag sheet for recommenders',
      archived: false,
      content: {
        source: 'text',
        text: 'Brag sheet\n\nYour teacher will use this to write about you. Be specific.\n\nClasses with this teacher, and the years:\nA piece of work from the class you are proud of, and why:\nA time you struggled in the class and what you did about it:\nWhat you do outside class that this teacher may not know:\nWhat you plan to study, and what led you to it:\nThree words you hope the letter brings to mind:',
      },
    },
  ]
}
