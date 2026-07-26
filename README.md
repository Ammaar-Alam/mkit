<p align="center">
  <img src="docs/assets/mkit-readme-hero.png" alt="An open study folio surrounded by plants, shapes, and molecular sketches">
</p>

# MKit — The MCAT Kit

MKit is a study companion for students studying for the MCAT through AAMC's website.The goal is to give students a suite of tools on AAMC's official practice materials. The first tool, Fresh Attempt, is designed to let a learner try completed full-length or section-review questions again while keeping the official solutions (and their prior answers) hidden.

> MKit is an independent project. It is not affiliated with, endorsed by, or sponsored by the Association of American Medical Colleges.

## Install

[Install MKit from the Chrome Web Store](https://chromewebstore.google.com/detail/mkit-%E2%80%94-the-mcat-kit/lfmldlmodicabjfegocoehckdedkcnlf).
It works in Chrome and Arc.

[Download the latest GitHub release](https://github.com/Ammaar-Alam/mkit/releases/latest) for a manual install.

## What Fresh Attempt does

- Hides your old answers, the correct answers, explanations, results, and review markers.
- Offers two modes: **Practice** lets you check each answer, while **Test** waits until you finish.
- Lets you answer questions, cross out choices, rate your confidence, flag questions, and write notes.
- Saves your progress and study time in your browser.
- Leaves your original AAMC attempt unchanged.

## How to use it

1. Open a completed full-length or section review on AAMC's official practice website.
2. Choose **Practice** or **Test**. Choose **Normal review** to see the page without MKit.
3. Answer the questions again.
4. Check each answer in Practice, or finish the review in Test.

## Supported pages

MKit currently works on completed full-length answer reviews and completed section **Review All** pages. It never runs during an active exam.

See [Supported pages](docs/supported-pages.md) for the exact list and known limits.

## Privacy

MKit does not collect or sell your data. It has no analytics, ads, or server. By default, your Fresh Attempt data stays on your device. Browser sync is optional.

MKit never saves AAMC questions, passages, answer choices, explanations, images, correct answers, old answers, or scores.

The extension can access only supported completed-review pages. It cannot submit answers, reset an exam, bypass access controls, or change your account.

Read the full [privacy policy](PRIVACY.md) and [security policy](SECURITY.md).

## Build from source

Requirements:

- Node.js 20 or newer
- pnpm 10 or newer

```bash
pnpm install
pnpm build
pnpm check
```

`pnpm build` puts an unpacked extension in `dist/`. `pnpm package` puts a versioned ZIP in `release/`. Git ignores both folders.

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

The same `dist` folder works in Arc and Chrome.

## Contributing

Use only made-up test data. Never add copied practice questions, explanations, screenshots, scores, answer keys, account data, or captures from a signed-in page.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## License

[MIT](LICENSE)
