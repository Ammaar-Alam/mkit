# Supported pages

MKit 0.1 currently targets completed full-length answer-review pages on `www.mcatofficialprep.org`.

The manifest is limited to `https://www.mcatofficialprep.org/app/aamc-mcat-practice-exam-*`. Inside that path family, the production adapter activates Fresh Attempt only for the confirmed completed-answer hash shape. Other hashes are treated as non-review pages, and MKit does not invoke native answer, navigation, submission, reset, or account controls.

| Surface | MKit 0.1 status | Behavior |
| --- | --- | --- |
| Completed full-length answer review | Production-wired; post-fix live pass pending | Clean Slate, Practice, Test, and local resume |
| Completed full-length score report | Separate verification pending | Score Shield remains fail-closed and is not yet a supported live surface |
| Active exam | Never supported | Fresh Attempt does not activate or use native controls |
| Sample tests | Planned after separate inspection | No adapter in 0.1 |
| Question packs and banks | Planned after separate inspection | No adapter in 0.1 |
| Registration and account pages | Never supported | MKit does not run |

Unknown layouts on the confirmed answer-review route remain covered. **Normal review** always restores the untouched page.
