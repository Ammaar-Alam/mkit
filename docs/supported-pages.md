# Supported pages

## AAMC

MKit currently targets completed full-length answer reviews, completed section
Review All questions, and the question list on a completed section score report
at `www.mcatofficialprep.org`.

The manifest is limited to
`https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-*`. Inside that
path family, the production adapter activates Fresh Attempt only for confirmed
completed-review routes. MKit does not invoke native answer, navigation,
submission, reset, or account controls.

| Surface | Status | Behavior |
| --- | --- | --- |
| Completed full-length answer review | Supported | Clean Slate, Practice, Test, local resume, and optional clearing of earlier highlights and cross-outs |
| Completed section Review All question | Supported | The same spoiler-safe Fresh Attempt flow, with native section navigation preserved |
| Completed section score report | Supported | Correct and incorrect marks are replaced with a neutral MKit mark by default; filters, previews, timing, and Review links stay native |
| Completed full-length score report | Separate verification pending | Score Shield remains fail-closed and is not yet a supported live surface |
| Active exam | Never supported | Fresh Attempt does not activate or use native controls |
| Sample tests | Planned after separate inspection | No adapter |
| Question packs and banks | Planned after separate inspection | No adapter |
| Registration and account pages | Never supported | MKit does not run |

## UWorld

The manifest is limited to `https://apps.uworld.com/courseapp/gradschool/v*`.
The adapter activates Fresh Attempt only on the test interface when its header
reads **REVIEW**, so live QBank tests and practice exams are left alone.

| Surface | Status | Behavior |
| --- | --- | --- |
| Completed QBank test review | Supported | Clean Slate, Practice, Test, local resume, and optional clearing of earlier highlights and strikethroughs |
| Completed practice exam section review | Supported | The same Fresh Attempt flow, one session per section |
| QBank test results and practice exam section results | Supported | Correct and incorrect marks are replaced with a neutral MKit mark by default; filters and Review links stay native |
| Practice exam score overview | Not covered | Section scores stay native |
| Live QBank test or practice exam | Never supported | Fresh Attempt does not activate |

The review navigator's per-question marks stay hidden while Fresh Attempt is
active. UWorld's peer percentages, time spent, and explanation are revealed
together with the answer.

Unknown layouts on a confirmed review route remain covered. **Normal review**
restores the native page, and the popup's **MKit** switch can release every open
supported page in the current browser. When a trustworthy question total is
unavailable, MKit says **Current question** instead of inventing progress.
