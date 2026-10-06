# Signal K Target Fusion

Signal K server plugin that links `targets.*` contexts (radar ARPA, camera
detections) to the `vessels.*` AIS vessel or other target that is the same
object, by publishing `sameAs` on the target. Consumers (collision alarms,
plotters) treat each context without `sameAs` as one object.

## Module map (`src/`)

- `index.ts` — plugin lifecycle; the timer that reads the data model and
  publishes `sameAs` changes.
- `fusion.ts` — `Fusion`: runs association, keeps the previous grouping for
  hysteresis, and returns only the `sameAs` values that must change.
- `association.ts` — pure matching: MMSI first, then dead-reckoned position
  gate plus course/speed agreement; one target per sensor per object.
- `config.ts` — TypeBox `ConfigSchema` (admin form and TS type in one) and
  `DEFAULTS`.
- `model.ts` — reads AIS vessels and targets out of the full data model.

## Contracts other software depends on

- **`sameAs` on `targets.<type>:<id>`** holds the context that names the
  object (an AIS vessel, or the target that first saw a boat without AIS),
  or `null`. Links never chain. Changing this is a breaking change for every
  consumer.
- **Withdraw what you link.** `stop()` publishes `null` for every link this
  plugin made that still holds the value it published, or consumers keep
  hiding targets behind a vessel. A link another writer set is left alone.

## Gotchas

- **Schema defaults are not applied at runtime.** `start()` receives `{}` for a
  plugin that was never configured; always merge `DEFAULTS` under the config.
- **No install scripts.** The app store installs with `--ignore-scripts`; keep
  runtime dependencies pure JS (today: `typebox` only).
- **TypeBox 1.x is the unscoped `typebox` package**, not `@sinclair/typebox`
  (frozen at 0.34, reached only through `@signalk/server-api`).
- **ESM.** Relative imports carry the `.js` extension (nodenext module
  resolution); the entry is `export default function (app)`.

## Commands

- `npm run format` — prettier + eslint --fix
- `npm run ci-lint` — read-only lint + format check (what CI runs)
- `npm run typecheck` — tsc over `src/` and `test/`
- `npm run build` — Vite → `plugin/index.js`; `vite-plugin-checker` fails the
  build on any type error in `src/`, since Vite itself only transpiles
- `npm test` — vitest
- `npm run build:all` — all of the above, run before every commit

## Workflow

- Conventional commits and PR titles: `<type>(<scope>): <subject>`; PR titles
  become the generated release notes.
- One logical change per PR. Never bump the version in a feature PR.
- Branch names use hyphens, no `/`.
- No AI attribution in commits or PRs: no `Co-Authored-By` trailers, no
  "generated with" footers.
- **Squash-merge PRs.** The release gate reads commit subjects, so the PR
  title must be the commit subject on `main`.
- **Releases are release-please**, publishing to npm via OIDC trusted
  publishing (no `NPM_TOKEN`). Never edit the version by hand.
