# Supported pages

MKit 0.1 targets completed AAMC full-length exam score reports and Review All pages.

Production page patterns are not enabled until synthetic no-spoiler tests pass and the exact completed-review host, route, frame, and stable identifiers are verified. This prevents a broad content-script match from affecting registration, active exam, account, or unrelated preparation pages.

| Surface | MKit 0.1 status | Behavior |
| --- | --- | --- |
| Completed full-length score report | Verification pending | Score Shield and Fresh Attempt entry |
| Completed full-length Review All | Verification pending | Clean Slate, Practice, Test, resume, and summary |
| Active exam | Never supported | MKit does not run |
| Sample tests | Planned after separate inspection | No adapter in 0.1 |
| Question packs and banks | Planned after separate inspection | No adapter in 0.1 |
| Registration and account pages | Never supported | MKit does not run |

Unknown layouts remain covered only after an exact supported route is enabled. **Normal review** always restores the untouched page.
