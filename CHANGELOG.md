# Changelog

All notable changes to MKit are documented here.

## [Unreleased]

## [0.2.1] - 2026-07-27

### Fixed

- Cleared prior highlights and crossed-out choices that AAMC hydrates or
  reapplies after the first review scan, while preserving annotations added
  after a Fresh Attempt begins.

## [0.2.0] - 2026-07-26

### Added

- Added a browser-local MKit On/Off switch that releases supported open pages
  without deleting Fresh Attempt progress.
- Added settings to clear earlier AAMC highlights and crossed-out choices during
  Fresh Attempt. Both default to On and leave new annotations usable.
- Added a setting to replace per-question correct and incorrect marks on a
  completed section score report with a neutral MKit mark.
- Added the review settings to both the extension popup and the full settings
  page.

### Changed

- Moved review settings to the top of the popup and hid empty session history.
- Made notes and tags available throughout Practice and Test instead of only
  after revealing the original attempt.
- Redesigned the Fresh Attempt rail with a fixed compact header, fixed next
  action, circular answer controls, quieter cross-outs, and clearer selected
  states.
- Placed the Fresh Attempt rail below AAMC's highlighting controls by default
  and kept that position through answer and save updates.
- Used the packaged MKit artwork in extension surfaces and for concealed result
  marks.

### Fixed

- Made every Normal review action release MKit on the first click and removed the
  transparent full-page host that could leave the restored AAMC page frozen.
- Kept Practice, Test, and Normal review responsive while AAMC updates unrelated
  parts of a completed review page.
- Kept section-result marks concealed when AAMC mounts or replaces the question
  list after a page refresh, and rendered the neutral MKit mark from bundled
  artwork instead of the AAMC page origin. Repeated coverage now restores each
  result cue's original accessibility state.
- Preserved passage selection, copying, and native annotation tools during a
  Fresh Attempt.
- Kept a persisted MKit Off setting from touching a review during startup, and
  restored the native page immediately when MKit is turned Off without a reload.
- Restored native scores immediately when Score Shield is turned Off on an open
  report.
- Preserved notes, answers, confidence, and reflection changes made in quick
  succession instead of allowing one save to overwrite another.
- Kept ordinary study saves from refreshing unchanged settings and interrupting
  typing in the note editor.
- Kept the browser-local MKit switch from taking sync ownership of unrelated
  review preferences changed on another browser.
- Cleared prior highlights and cross-outs when AAMC reuses a question container
  across navigation, while preserving annotations added during the current
  Fresh Attempt on return visits.
- Repositioned the rail for each new question while retaining its position
  through saves on the current question.
- Kept the rail inside the viewport and its header and next action reachable
  while its contents scroll, including when native tools sit near the bottom of
  a short viewport.
- Used Chrome-valid origin matches for packaged page artwork so the unpacked
  extension loads successfully.

## [0.1.2] - 2026-07-26

### Changed

- Replaced the extension icon and README header with the new MKit artwork.
- Rewrote the README, extension description, and About text in clearer language.
- Made build, package, test, and CI artifact naming read from the package version
  instead of repeating a release number.

## [0.1.1] - 2026-07-26

### Fixed

- Conceal the native solution and explanation on completed review questions
  that were answered incorrectly in the original attempt. The feedback remains
  hidden through Check and appears only after an explicit answer reveal.

## [0.1.0] - 2026-07-26

First release. MKit lets you reattempt a completed AAMC full-length or section
review without seeing your earlier answers, the official answers, or the
explanations until you ask for them.

### Added

- Fresh Attempt on a completed full-length review and on a completed section
  review opened through Review All. Activation is automatic on a recognized
  review and needs no setup.
- Practice mode with Check for a Correct or Incorrect result, and Test mode that
  keeps every result concealed until you finish.
- Two deliberate reveals, each opt in and separate: `Reveal answers` for the
  official answer and explanation, then `Reveal original attempt` for what you
  chose the first time.
- Answer selection, choice elimination, confidence, bookmarks, a needs-more-
  practice marker that feeds your weak topics, private notes, and tags.
- Retry, which clears a question back to concealed so you can answer it again.
- Finish attempt, plus Finish section on a section review so the rest of the
  attempt stays open.
- A post-session summary of your own results: counts by section and question
  type, timing, and the content categories to revisit.
- A compact study rail you can collapse or drag out of the way, with arrow keys
  and Home as the keyboard equivalent.
- Keyboard shortcuts while a question is concealed: A-D or 1-4 to select,
  Shift with a letter to eliminate, Enter to check, F to bookmark, R to mark
  needs more practice, and `[` or `]` for the native previous and next controls.
- Correctness cover on the completed section overview, so the per-question
  correct and incorrect marks in the list are neutral until you reveal them.
  Previews, filters, sorting, pagination, and every Review link keep working.
- Score Shield for completed score pages, with an explicit reveal.
- `Normal review` in every state, which restores the authored page exactly and
  leaves no MKit markup behind.
- A popup reporting whether MKit is running on the current tab, and an options
  page for protection, Score Shield, default mode, encouragement, browser sync,
  and a local compatibility log.

### Privacy

- No network requests, no service worker, no remote code, and no analytics. The
  only permission requested is `storage`.
- The content script runs on
  `https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-*` and nowhere
  else.
- Stored records never contain question text, passages, choices, explanations,
  official or original answers, scores, images, or account data. Route, exam,
  section, and question identifiers are hashed before storage.
- MKit never answers, submits, resets, or finishes an official exam, never acts
  on an exam in progress, and never changes your account.

### Notes

- MKit covers a review only when it can verify the page layout. On an
  unrecognized or changed layout it leaves the native page untouched rather than
  guessing, and the popup reports why.
- The study rail shows `Current question` instead of a position and total,
  because the review navigator exposes no question count that can be read
  without reading page content.
- Previously authored highlights stay visible during a reattempt.
