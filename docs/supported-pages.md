# Supported pages

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

Unknown layouts on a confirmed review route remain covered. **Normal review**
restores the native page, and the popup's **MKit** switch can release every open
supported page in the current browser. When a trustworthy question total is
unavailable, MKit says **Current question** instead of inventing progress.
