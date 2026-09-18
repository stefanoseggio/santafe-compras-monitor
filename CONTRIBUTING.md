# Contributing

This repository ships the real, buildable TypeScript source for the **Santa Fe Argentina Licitaciones — Tender Delta API** Apify Actor. It is independently maintained by Stefano Seggio as part of the [Delta Registry](https://github.com/stefanoseggio) fleet — there is no separate contributor team, but external bug reports, source-coverage proposals, and documentation fixes are welcome.

## Local setup

```bash
git clone https://github.com/stefanoseggio/santafe-compras-monitor.git
cd santafe-compras-monitor
npm install
apify login    # one-time; stores your Apify token locally, needed only for `apify run`
apify run --purge --input '{"estados":["AP"],"maxItems":20,"fetchDetail":false}'
```

No third-party credentials are required — this Actor's `byok` status is `none` (see the README's Cost & BYOK Disclosure section). The register is a plain server-rendered site with no login wall, so no proxy configuration is needed either.

## Development workflow

```bash
npm run start:dev     # tsx src/main.ts
npm run lint           # eslint
npm run lint:fix       # eslint --fix
npm run format         # prettier --write .
npm run build          # tsc
npm test               # vitest run
npm run test:live      # optional: live tests against the real site (LIVE=1)
```

Then inspect `storage/datasets/default/*.json` from a local `apify run`, not just the log tail — `storage/` is local-only and never synced to Apify Console; confirming real cloud behavior (delta state persistence, scheduling, the full `recheckWindowDays` sweep) requires `apify push` to a build tag and a real run on the platform.

## Branch naming

- `fix/<short-description>` — bug fixes
- `feat/<short-description>` — new input fields, new output fields, new source coverage
- `docs/<short-description>` — README/documentation-only changes
- `chore/<short-description>` — dependency bumps, tooling, CI changes

## Commit convention

This repository follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary>

<optional body>
```

Types used here: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`. The `type` prefix drives automated changelog generation via `release-please` (see [`.github/workflows/release.yml`](.github/workflows/release.yml)) — a `feat:` commit triggers a minor version bump, `fix:` triggers a patch bump, and `feat!:`/a `BREAKING CHANGE:` footer triggers a major bump. Non-conventional commit messages are still accepted but won't be reflected in the auto-generated changelog entry for that change.

## Pull requests

1. Fork or branch, make your change, and ensure `npm run lint`, `npm run build`, and `npm test` all pass locally.
2. Open a PR against `main` using the repository's [PR template](.github/PULL_REQUEST_TEMPLATE.md).
3. CI (`.github/workflows/test.yaml`) runs automatically and must pass before merge.
4. Behavioral changes to the Actor's input/output schema should also update `.actor/input_schema.json` / `.actor/dataset_schema.json` and the corresponding README sections in the same PR — schema and documentation drift is treated as a real bug, not a follow-up.

## Questions or non-code issues

For questions that aren't a code change (pricing, licensing, enterprise inquiries), use the Apify Store's Issues tab on the [live Actor page](https://apify.com/stefano_seggio/santafe-compras-monitor) rather than a GitHub issue.
