# Landing page: proof

The page at `/` for a signed-out visitor: `src/landing/`. Everything here was taken from `preview.html` (or, for the measurements, from the production build served by `vite preview`) in headless Chrome on a laptop. **Not checked:** Safari, Firefox, a real phone, a screen reader in use, a slow real network.

## Screenshots

- `states/`: every state of every interactive piece and every chapter at each step of its scene, 50 per size, at 1440, 768 and 375 wide, light and dark (300 files). Names are `NN-what-width-theme.webp`, in the order a visitor meets them:
  - `01`–`05` the hero and its Inbox card: the draft, in English, approved and counting down, undone, sent
  - `06`–`10` After the meeting at steps 0 to 3, and a draft line traced back to the phrase in the notes
  - `11`–`30` The workspace at steps 0 to 3, then each of the eight areas, before and after its live detail is used
  - `31`–`37` Families at steps 0 to 2, the three languages, and a fact showing where in the record it came from
  - `38`–`47` AI rules at steps 0 to 3, the number changed and snapped back, the three margin notes, the update still waiting when scrolled past, the gate approved and sent
  - `48`–`50` Early access, the form's errors, and "nothing was sent"
- `scroll/`: the whole page from top to bottom, a frame every 60% of a screen, at the same three widths in both themes, plus `…-reduced.webp` sequences at 1440 and 375 with reduced motion on.

A chapter's "start, middle and end" are its steps: step 0 is before the scene, the last step is its end. Scenes hold still while they play only when all of the scene fits on the screen (a laptop about 900px tall or more); otherwise they scroll and play as they pass.

## Reduced motion

With `prefers-reduced-motion: reduce`, measured at 1440 and 375:

- Every scene is at its last step when the page loads, and nothing is pinned.
- No piece is hidden or dimmed waiting for a step: every card, draft line, area and panel is at full opacity.
- No animation runs, on load, while scrolling, or during the Undo countdown (the countdown shows as a number only).
- The page still follows which chapter is on screen, so the notes change with it (without the turn or the tilt) and the chapter index is right.
- Every interaction still works: Approve and Undo, the language switch, the tabs, the number that goes back, the margin notes, the form.
- The spark on the reading-progress line is hidden; the line itself still fills.

## Keyboard only

Tab from the top of the page, at 1440 and 375:

- Every control is reached: 55 of 55 at 1440, 45 of 45 at 375 (the phone has one menu for the chapters in place of the header links and the dots).
- Every one shows a 2px focus ring, and every one has a name.
- The order is the header, the notes and the hero's Inbox card, then the chapters in reading order.
- Enter or Space on Approve starts the countdown and moves focus to Undo; Undo moves it back to Approve. Focus is never left on nothing.
- Left and Right move between the eight workspace areas, as tabs do.
- Focusing a draft line draws its line to the notes; focusing a highlighted fact shows where it came from. Neither needs a pointer.
- Whatever takes focus is scrolled clear of the header and of the notes held at the top of a phone. One exception measured, at 375: the "What you use today" box, three lines tall, can be partly below the screen's edge when it takes focus; it is visible and can be typed in.
- A header link, a chapter dot or the phone's chapter menu moves focus to the chapter it jumps to, so the next Tab carries on from there. "Request early access" lands on the form itself.
- A control that takes focus before its scene has reached it is shown at once, with the card around it.
- Pressing the college in the College lists panel moves it to the next band and keeps focus on it.

## Measurements

The production build, phone profile: 390 wide, 4x CPU slowdown, 1.6 Mbps down with 150 ms latency. This stands in for Lighthouse, which is not installed in this repository and was not added.

| | Light | Dark |
| --- | --- | --- |
| First contentful paint | 1.34 s | 0.83 s (second load, cached) |
| Largest contentful paint | 1.72 s | 1.80 s |
| Blocking time on load (long tasks over 50 ms) | 125 ms | 130 ms |
| Layout shift on load | 0 | 0 |
| Layout shift after scrolling the whole page | 0 | 0 |
| Frames while scrolling the whole page | median 16.7 ms, 95th 16.8 ms, 0 of 294 over 34 ms | the same |
| Requests | 11, 184 kB | cached |
| Requests to another origin | 0 | 0 |
| Requests for workspace code | 0 | 0 |

The frame times are with the CPU slowed four times on a laptop: every frame of the scroll was within a 60-frames-a-second budget. A real mid-range phone was not used, so this is an estimate of one, not a measurement on one.

Accessibility, checked by script on every visible text and control in both themes:

- No visible text below 4.5:1 (3:1 for large text). Cards that have not reached their step yet are dimmed on purpose and were not counted; they are at full strength once reached, and always with reduced motion.
- A tap on a draft line or a fact holds its highlight until the next tap anywhere else, including in Safari, where a tapped button does not take focus.
- 52 controls, none without a name; no form field without a label; every target at least 44px tall except the skip link, which appears only on focus.
- One `h1`, headings in order, `lang="en"` with `lang` set on Chinese text, no image without `alt`.
- `noindex` is kept. The title, description and share image are set in `index.html`.

## The skill

`ui-ux-pro-max` was run for this part (its design-system search and its searches on scroll motion and reduced motion). Its generated palette, typeface and style were not used: the brand is frozen. What was taken from it: end states under reduced motion, no scroll-jacking, contrast and focus rules, 44px targets, the four test widths, and its pre-delivery checklist, which the sections above answer item by item.
