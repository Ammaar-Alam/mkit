# Supported pages

MKit 0.1 currently targets completed full-length answer reviews and completed section Review All questions on `www.mcatofficialprep.org`.

The manifest is limited to `https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-*`. Inside that path family, the production adapter activates Fresh Attempt only for the confirmed completed full-length and section-review hash families. Other hashes are treated as non-review pages, and MKit does not invoke native answer, navigation, submission, reset, or account controls.

| Surface | MKit 0.1 status | Behavior |
| --- | --- | --- |
| Completed full-length answer review | Production-wired; post-fix live pass pending | Clean Slate, Practice, Test, and local resume |
| Completed section Review All question | Production-wired; live pass pending | The same spoiler-safe Fresh Attempt flow, with native section navigation preserved |
| Completed section results overview | Not yet supported | The page remains untouched until stable row-preview anchors are confirmed |
| Completed full-length score report | Separate verification pending | Score Shield remains fail-closed and is not yet a supported live surface |
| Active exam | Never supported | Fresh Attempt does not activate or use native controls |
| Sample tests | Planned after separate inspection | No adapter in 0.1 |
| Question packs and banks | Planned after separate inspection | No adapter in 0.1 |
| Registration and account pages | Never supported | MKit does not run |

Unknown layouts on either confirmed review route remain covered. **Normal review** always restores the untouched page. When a trustworthy question total is unavailable, MKit says **Current question** instead of inventing progress.
