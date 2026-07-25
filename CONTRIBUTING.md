# Contributing

Thank you for helping make MKit safer and more useful.

## Before changing code

1. Read [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [Supported pages](docs/supported-pages.md).
2. Keep every site-specific selector inside `AamcFullLengthReviewAdapter`.
3. Work from synthetic fixtures. Never commit or paste official practice questions, passages, answer choices, explanations, screenshots, scores, answer keys, identity data, cookies, or tokens.
4. Keep changes small and traceable to an issue or documented requirement.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
pnpm audit:release
```

Pull requests should describe the behavior, privacy impact, and exact checks run. A change that weakens the no-spoiler first paint, sanitization boundary, permission scope, or zero-network guarantee cannot merge.
