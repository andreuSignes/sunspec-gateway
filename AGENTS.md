# AGENTS.md

Repo-specific guidance for OpenCode sessions in `solar-home` (a NestJS SunSpec Modbus TCP gateway for a Solplanet ASW H-S2 inverter). Read `README.md` for the user-facing tour; this file is the agent-only field guide.

## Stack at a glance

- NestJS 10 + TypeScript 5 (`strict`, `strictPropertyInitialization: false`, `experimentalDecorators`).
- Node 24 (`.nvmrc`), pnpm 11 (`packageManager` field — activate with `corepack enable`).
- ESLint v9 flat config (`typescript-eslint`, `@typescript-eslint/no-explicit-any: warn`).
- Jest 29 + ts-jest. Two configs: unit (`jest.config.ts`, `*.spec.ts` under `src/` + `test/unit/`) and e2e (`jest-e2e.config.ts`, `*.e2e-spec.ts` under `test/e2e/`).
- Husky `commit-msg` → `pnpm exec commitlint --edit "$1"`.

## Setup

```bash
nvm use                          # honour .nvmrc (Node 24)
corepack enable                  # activate pnpm@11 from package.json
pnpm install --frozen-lockfile
cp .env.example .env             # INVERTER_SN is required; empty string refuses to boot
```

`.npmrc` sets `optional=false` and `pnpm-workspace.yaml` sets `allowBuilds: '@nestjs/core': false`, `'@serialport/bindings-cpp': false` — both exist **only** to skip the `serialport@13` native build. The gateway is TCP-only. Do not "fix" these without checking the README's install section first.

## Everyday commands

| Task | Command |
|---|---|
| Dev (transpile-only, no hot reload) | `pnpm run start:dev` |
| Production-style | `pnpm run build && pnpm run start` |
| Lint | `pnpm lint` |
| Unit tests | `pnpm test` |
| Unit + coverage | `pnpm test:cov` |
| E2E (boots the gateway, drives it via `modbus-serial` client) | `pnpm test:e2e` |
| Health probe | `curl localhost:3000/healthz` |
| Verify Modbus (Python) | see README §Verifying — register `40084` is read as offset `84` |

CI runs `lint → build → test --coverage → test:e2e` on every PR (`.github/workflows/ci.yml`). The `Setup pnpm` step must run **before** `setup-node@v6` because `cache: 'pnpm'` shells out to pnpm to compute the cache key.

## Architecture seams (compiler-enforced)

Three layers, strict top-down:

```
SolplanetCgiAdapter (transport) → InverterStateService (bus) → SunSpecModbusServerService (wire)
```

- `InverterAdapter` is an **abstract class** (not TS interface) — bound via the `INVERTER_ADAPTER` DI token (`{ provide: INVERTER_ADAPTER, useExisting: SolplanetCgiAdapter }` in `gateway.module.ts`). To test without the inverter, register a `FakeAdapter` against the same token (`test/e2e/sunspec-modbus.e2e-spec.ts` shows the pattern).
- `SunSpecModbusServerService` **must not** import `@nestjs/axios`. If it ever needs network data, the seam is broken — push the call into a new adapter.
- The adapter's contract: `read(): Promise<InverterState>` **never throws**. HTTP errors, JSON parse errors, and bad numerics all resolve to an `isStale: true` `OFF` state. `InverterPollingService` wraps it in try/catch as belt-and-braces only.
- The cron is fixed at 5 s via `@Cron(CronExpression.EVERY_5_SECONDS)`. `POLL_INTERVAL_MS` is wired into config but the decorator ignores it in v1 — do not assume a dynamic interval.
- The Modbus server uses a **double-buffered register block** (`bufA`/`bufB`, atomic JS-level swap) so a concurrent Modbus read sees a coherent pre- or post-write block, never a torn mix.

## repo-specific gotchas

- **`modbus-serial` v8 quirk — `getMultipleHoldingRegisters` must return a sync `number[]`, not a `Promise<number[]>`.** Returning a promise causes Modbus exception 0x04 ("length mismatch"). See `sunspec-modbus-server.service.ts:262–278` for the rationale.
- **`modbus-serial` v8 type quirk** — `IServiceVector` omits `readDeviceIdentification` in its `.d.ts` but the runtime handler calls it. Extend the type at the call site (same file, `VectorWithReadDeviceId`) rather than patching node_modules.
- **`SunSpec address convention`**: the spec uses `40000` as base, but `modbus-serial` v8 invokes handlers with the **offset** (`addr - 40000`). So register `40084` is read as `getHoldingRegister(84)`. The README has a corrected register map; trust it over generic SunSpec docs.
- **Config validation crashes boot**, not 30 s later. `validateConfig` in `src/config/configuration.ts` checks every port against `[1, 65535]` (`MODBUS_UNIT_ID` against `[1, 247]`) and requires `INVERTER_SN` to be non-empty. Out-of-range → process exits with a descriptive log line.
- **E2E binds port 5021 by default** (`MODBUS_TEST_PORT`), not 5020, to avoid colliding with a dev server. The test polls the port with `waitForPort` until it accepts a TCP connection, then drives it via `modbus-serial` as a client. `pnpm test:e2e` runs `--runInBand`.
- **Stale policy** (`InverterStateService.snapshot()`): after `STALE_AFTER_MS` (30 s) without a fresh publish, `acPowerWatts/Voltage/Current/Hz` are zeroed and `operatingState` is forced to `OFF`, but `vendorName/modelName/serialNumber` and `lifetimeEnergyKwh` are preserved from `lastGood`. The adapter is allowed to pass any `lastUpdatedAt` (typically `0`); the bus stamps the real one.

## Commit conventions (enforced by husky → commitlint)

- **Header ≤ 72 chars**, **body/footer ≤ 100 chars/line** (commitlint config).
- **Type-case: lowercase only** — `feat:` not `Feat:`.
- **Subject first letter lowercase** — `feat: add foo`, not `feat: Add foo`.
- Conventional Commits via `@commitlint/config-conventional`.
- Do **not** add `Co-Authored-By` or AI attribution. Use conventional commits only.

## OpenSpec / SDD

The project plans changes through OpenSpec. The active change is at `openspec/changes/sunspec-modbus-gateway/` (proposal + design + specs + tasks). After implementation, archive by syncing the delta specs into `openspec/specs/`. Source-of-truth design numbers (cron interval, port defaults, stale threshold, M101 offsets) live in `openspec/changes/sunspec-modbus-gateway/design.md` and `openspec/changes/sunspec-modbus-gateway/specs/*.md` — when the code and these docs drift, trust the code and update the docs in the same change.

## Skills

A registry of available skills lives at `.atl/skill-registry.md`. When delegating, match by trigger and copy exact `SKILL.md` paths into the sub-agent prompt — never inject summaries. Relevant skills for this repo: `nestjs-best-practices`, `work-unit-commits`, `chained-pr`, `branch-pr`, `comment-writer`, `judgment-day`.

## Files most worth knowing

- `src/main.ts` — bootstrap; calls `enableShutdownHooks()` so the Modbus server gets `SHUTDOWN_TIMEOUT_MS` (5 s) to drain.
- `src/config/configuration.ts` — typed env loader + boot-time validator; the seam between `.env` and the rest of the app.
- `src/gateway/gateway.module.ts` — DI wiring; the single place that knows about all three layers.
- `src/modbus/sunspec-registers.ts` — M1/M101 offsets + write helpers; the canonical register map.
- `src/modbus/sunspec-modbus-server.service.ts` — projection, double buffer, `IServiceVector` impl.
- `docs/QG0028_ASW6000-10000-S_EN_540-30170-03_V04_0723-2.pdf` — Solplanet vendor doc; the source of truth for the CGI payload shape.
