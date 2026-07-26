# Privacy policy

Effective July 25, 2026

MKit — The MCAT Kit is a local-first browser extension for reviewing completed MCAT practice materials.

## Data collection

MKit does not collect, transmit, sell, rent, or share personal information. It has no analytics, telemetry, advertising, backend service, or extension-initiated external network requests.

## Data stored on the device

MKit may store:

- Extension settings
- Fresh Attempt session status and timestamps
- One-way SHA-256 exam and question identifiers
- Fresh answer letters and eliminated-choice letters
- Confidence, flag, and review-again markers
- Factual outcome labels: correct, needs review, or unknown
- Section, passage/discrete classification, and public content-category codes when present
- Active-viewing duration
- Notes and tags written by the learner
- A boolean recording whether Score Shield was revealed
- Recent compatibility events containing codes and counts

MKit is designed never to store question or passage text, answer-choice text, official explanations, original or correct answer keys, figures, screenshots, score values, names, account identifiers, cookies, tokens, or browsing history.

## Browser sync

Browser sync is optional and off by default. When enabled, MKit writes locally first and asks the browser’s built-in storage sync to copy sanitized study records. Notes that exceed the conservative sync budget remain only on the current device, and MKit reports that state.

Browser vendors control their sync systems and account security. Sync failure never blocks studying or removes the local copy.

## Page access

MKit’s static content script is limited to the verified full-length practice-exam path family. Its adapter activates Fresh Attempt only on the confirmed completed-answer review route and reads page structure in memory to conceal prior-attempt material and calculate a fresh outcome. Official answer and explanation content is not copied into extension storage.

MKit does not operate on active exams, submit answers, reset attempts, bypass access controls, or change account state.

## Data deletion

Settings and MKit-authored study data can be removed by clearing the extension’s site data or uninstalling MKit. Deletion tombstones prevent optional browser sync from restoring cleared study records.

## Changes

Material privacy changes will be documented in [CHANGELOG.md](CHANGELOG.md) and reflected in this policy before release.

## Contact

Use the repository’s private security reporting channel for privacy or security concerns.
