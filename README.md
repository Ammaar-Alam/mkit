<p align="center">
  <img src="docs/assets/mkit-readme-hero.png" alt="An open study folio surrounded by botanical, geometric, and molecular sketches in MKit's warm paper palette">
</p>

# MKit — The MCAT Kit

MKit is a private study companion for reviewing completed MCAT practice materials. Its first tool, Fresh Attempt, is designed to let a learner try completed full-length or section-review questions again without seeing the prior result first.

> MKit is an independent project. It is not affiliated with, endorsed by, or sponsored by the Association of American Medical Colleges.

## Install

[Install MKit from the Chrome Web Store](https://chromewebstore.google.com/detail/mkit-%E2%80%94-the-mcat-kit/lfmldlmodicabjfegocoehckdedkcnlf).
Chrome and Arc use the same published extension.

## Privacy first

MKit is local-first and has no analytics, backend, telemetry, ads, or remote runtime code. It is designed never to store or sync official question, passage, answer-choice, explanation, score, image, original-answer, or correct-answer content.

The extension requests only browser storage and narrowly scoped access to supported completed-review pages. It never operates on an active exam, submits an answer, resets an exam, bypasses access controls, or changes an account.

Read the complete [privacy policy](PRIVACY.md) and [security policy](SECURITY.md).

## Fresh Attempt

- Conceals prior results, answers, explanations, navigator markers, and metadata before a completed review is shown.
- Supports Practice and Test modes without changing the official submission.
- Saves fresh choices, eliminations, confidence, flags, private notes, tags, and active-viewing time locally.
- Keeps original-attempt content hidden until an explicit post-check reveal.
- Computes factual outcome and timing summaries without scaled scores, percentiles, readiness estimates, or mastery claims.
- Includes a fail-closed Score Shield implementation whose live score-report support remains pending separate verification.

MKit fails closed. If a supported page changes and protection cannot be verified, the review remains covered until the learner chooses **Normal review**.

## Status

MKit is available from the
[Chrome Web Store](https://chromewebstore.google.com/detail/mkit-%E2%80%94-the-mcat-kit/lfmldlmodicabjfegocoehckdedkcnlf).
[GitHub Releases](https://github.com/Ammaar-Alam/mkit/releases/latest) provide
the matching manual-install archive. The privacy core, exact completed
full-length and section-review route families, local-first persistence, popup,
options page, and package audit are covered by synthetic regression tests and
live completed-review verification.

The current support boundary is documented in [Supported pages](docs/supported-pages.md).

## Development

Requirements:

- Node.js 20 or newer
- pnpm 10 or newer

```bash
pnpm install
pnpm build
pnpm check
```

`pnpm build` writes an unpacked extension to `dist/`. `pnpm package` creates a
versioned ZIP under `release/`. Both directories are ignored.

The production extension contains no network client and loads no remote fonts, scripts, styles, or images.

Every push and pull request runs linting, typechecking, unit tests, synthetic Chrome privacy tests, the release audit, and ZIP packaging in GitHub Actions.

## Install from source

After `pnpm build`:

### Arc

1. Open `arc://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository’s `dist` directory.

### Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the same `dist` directory.

Arc and Chrome use the identical artifact.

## Contributing

Synthetic fixtures only—never add copied practice questions, explanations, screenshots, scores, answer keys, account data, or authenticated page captures. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or change.

## License

[MIT](LICENSE)
