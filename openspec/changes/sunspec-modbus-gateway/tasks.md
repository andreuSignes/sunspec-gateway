# Tasks: SunSpec Modbus Gateway

> **Phase**: sdd-tasks
> **Change**: `sunspec-modbus-gateway`
> **Inputs**: `proposal.md` (obs `578`), 9 spec files (obs `579`), `design.md` (obs `a7328f3f154d4647`), canonical SunSpec register map (obs `575`), exploration (obs `577`), init state (obs `576`).

## Preamble — chain strategy and review budget

The design forecast ~1020 LOC of code + tests + docs, which is ~2.5× the
D1 400-line per-PR review budget. The user pre-approved chained PRs
(preflight C1 = `ask-on-risk`, already triggered) and chose chained-PRs
over `size:exception` because each slice has an autonomous verification
gate and a clean rollback boundary.

**Delivery model: GitHub Flow.** Each PR targets `main` directly (no
parent chain). Every branch is short-lived and merges independently.
This keeps review focus tight and makes every PR individually revertible
without unwinding a chain.

**Branch graph (three parallel PRs against `main`):**

```
main ◄── pr1/domain-state-scalefactor   (this PR — foundation)
main ◄── feat/modbus-server-registers   (PR2 — Modbus wire + e2e)
main ◄── feat/solplanet-adapter-module  (PR3 — HTTP adapter + wiring + README)
```

PR2 and PR3 each depend on PR1 having landed in `main`. They are
developed in parallel off `main` after PR1 merges — no chain branches,
no tracker branch.

**Branch naming**: `feat/<scope>` for feature PRs (GitHub Flow
convention). The PR1 branch keeps its `pr1/...` name because the PR is
already open — renaming would invalidate the PR URL.

**Per-PR discipline:** each PR is independently mergeable, each carries
its own verification gate, and each task is one commit (work-unit-commits:
"commit by work unit, not by file type; tests/docs belong with the unit
they verify").

**Forecast at a glance:**

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1020 (effective code ~870) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | ask-on-risk (already triggered, user approved chained) |
| Flow model | GitHub Flow (each PR targets `main`) |
| Decision needed before apply | No (locked at preflight) |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Flow model: GitHub Flow (each PR targets main)
400-line budget risk: High
```

## PR1 — Domain types, adapter interface, state bus, scale-factor

**Branch**: `pr1/domain-state-scalefactor` ← branches from `main`
**Estimated LOC**: ~270 (8 tasks, 8 commits)
**Independently mergeable**: yes — no transport, no protocol surface.
**Verification gate**: `npm test` passes with zero external dependencies.

### 1.1 Scaffold project tooling
- [ ] 1.1 Create `package.json` with production deps (`@nestjs/common`,
  `@nestjs/core`, `@nestjs/config`, `@nestjs/axios`, `@nestjs/schedule`,
  `axios`, `modbus-serial@8.0.25` (pinned), `reflect-metadata`, `rxjs`),
  dev deps (`typescript`, `ts-node`, `@types/node@20`, `jest`, `ts-jest`,
  `@types/jest`, `@nestjs/testing`, `supertest`, `nock`), and
  `engines.node: ">=20"`.
- [ ] 1.2 Add `.npmrc` with `optional=false` so `modbus-serial`'s
  `serialport@13` native build is skipped — TCP-only path is sufficient.
- [ ] 1.3 Add `jest.config.ts` (unit only — e2e config lands in PR2) and
  `tsconfig.json` with `strict: true`, `experimentalDecorators: true`,
  `emitDecoratorMetadata: true`, target `ES2022`, module `commonjs`.
- [ ] 1.4 Add npm scripts: `test`, `test:watch`, `build`, `start:dev`.

**Commit**: `chore: scaffold nestjs + jest + modbus-serial project tooling`.

### 1.2 Domain types
- [ ] 1.2 Add `src/domain/inverter-state.ts` containing:
  `InverterStatus` union (1..8 per SunSpec M101.St), `InverterState`
  interface (SI base units, all fields `readonly`, includes `isStale`
  and `lastUpdatedAt`), `INVERTER_ADAPTER` DI token (`Symbol`), and
  `M101_ST` const enum mapping our status names to SunSpec numeric codes.
- [ ] 1.3 Add a JSDoc block at the top documenting that all numeric
  fields are SI base units and the type carries no `*_SF`.

**Commit**: `feat(domain): add InverterState, InverterStatus, INVERTER_ADAPTER token`.

### 1.3 Scale-factor helpers
- [ ] 1.4 Add `src/modbus/scale-factor.ts` with pure helpers:
  `chooseScaleFactor(value, maxAbs=INT16_MAX)` (clamps SF to `[-10, +10]`,
  returns 0 for `0` and `NaN`), `applyScaleFactor(value, sf)`
  (rounds + clamps to `int16` range), `encode(value)` (one-shot helper),
  `splitAcc32(value)` (BE hi/lo pair for `acc32` registers). JSDoc each
  helper with the table from design.md §4.

**Commit**: `feat(modbus): add scale-factor helpers with int16 overflow guard`.

### 1.4 State bus with double-buffer
- [ ] 1.5 Add `src/state/inverter-state.service.ts` — singleton service
  with `publish(state)` (records `lastUpdatedAt` only when
  `!state.isStale`) and `snapshot()` (returns the published state when
  within `STALE_AFTER_MS=30000`, otherwise zeros production fields,
  sets `operatingState=OFF` and `isStale=true`, preserves
  `lifetimeEnergyKwh` + identity fields).
- [ ] 1.6 JSDoc the stale-data policy referencing design.md §9.

**Commit**: `feat(state): add InverterStateService with stale-after-30s policy`.

### 1.5 Adapter interface
- [ ] 1.7 Add `src/gateway/inverters/inverter.adapter.ts` exporting the
  abstract class `InverterAdapter` (`vendorName`, `modelName`,
  `read(): Promise<InverterState>`) and the `INVERTER_ADAPTER` injection
  token. Use abstract class (not TS interface) for NestJS DI ergonomics
  per `di-use-interfaces-tokens`.

**Commit**: `feat(gateway): add InverterAdapter abstract class + DI token`.

### 1.6 Scale-factor unit tests
- [ ] 1.8 Add `src/modbus/scale-factor.spec.ts` — table-driven tests
  covering: `0`, `230.5`, `4500`, `50000` (downgrade), `1e15` (clamps
  to `INT16_MAX` at `SF=-10`), `-100`, `NaN`; `applyScaleFactor` clamps;
  `splitAcc32` for `12345` → `{ hi: 0x3039, lo: 0x0000 }`, `0`, `2^32-1`,
  `2^31`.

**Commit**: `test(modbus): cover scale-factor edge cases (NaN, clamp, splitAcc32)`.

### 1.7 State-bus unit tests
- [ ] 1.9 Add `src/state/inverter-state.service.spec.ts` — uses
  `jest.useFakeTimers()` to advance `Date.now()`. Asserts: cold-start
  defaults are stale/off; fresh publish flips `isStale=false`; advancing
  past 30 s with no fresh publish yields zeroed production fields,
  `operatingState=1`, `isStale=true`, but **preserves**
  `lifetimeEnergyKwh` + identity fields; a fresh publish after a stale
  period restores live data.

**Commit**: `test(state): cover InverterStateService stale detection`.

### 1.8 PR1 verification
- [ ] 1.10 Run `pnpm install --frozen-lockfile` (serialport skipped via
  `--no-optional` or `.npmrc` `optional=false`) and `pnpm test`. All
  green. No live inverter. No Modbus server bound.

### 1.9 Migrate to pnpm 11
- [ ] 1.11 Add `"packageManager": "pnpm@11.0.0"` to `package.json`.
- [ ] 1.12 Delete `package-lock.json`.
- [ ] 1.13 Replace `.npmrc` with `shamefully-hoist=true`,
  `strict-peer-dependencies=false`, `auto-install-peers=true`.
  `shamefully-hoist=true` is required because NestJS packages transitively
  pull hoisted deps that pnpm's default isolated layout breaks.
- [ ] 1.14 Run `pnpm install` to regenerate `pnpm-lock.yaml`.
- [ ] 1.15 Update npm scripts: `test`, `test:watch`, `build`,
  `start:dev` already use the right CLI invocations — keep as-is; pnpm
  runs them transparently.

**Commit**: `chore(deps): migrate to pnpm 11 (packageManager field, .npmrc, pnpm-lock.yaml)`.

### 1.10 Add ESLint v9 flat config
- [ ] 1.16 Add `eslint.config.js` with `@eslint/js` recommended +
  `typescript-eslint` recommended; ignores `dist/`, `coverage/`,
  `node_modules/`; rule overrides: `no-unused-vars` (argsIgnorePattern:
  `^_`), `explicit-function-return-type: off`, `no-explicit-any: warn`.
- [ ] 1.17 Add dev deps: `eslint`, `@eslint/js`, `typescript-eslint`.
- [ ] 1.18 Add `lint` script: `"lint": "eslint ."`.
- [ ] 1.19 Run `pnpm lint` — fix any issues that surface.

**Commit**: `chore(lint): add ESLint v9 flat config with typescript-eslint`.

### 1.11 Add GitHub Actions CI
- [ ] 1.20 Add `.github/workflows/ci.yml` triggered on `pull_request` and
  `push` to `main`. Steps: checkout, setup-node@20 with `cache: pnpm`,
  `corepack enable pnpm`, install via `pnpm install --frozen-lockfile`,
  `pnpm lint`, `pnpm build`, `pnpm test -- --coverage`. `runs-on:
  ubuntu-latest`, `timeout-minutes: 10`.
- [ ] 1.21 Confirm the CI workflow runs green on this PR (Actions tab).

**Commit**: `ci: add GitHub Actions workflow (lint + build + test on PRs)`.

### 1.12 PR1 verification gate (updated)
- [ ] 1.22 Run `pnpm install --frozen-lockfile && pnpm lint && pnpm test`.
  All green. No live inverter. No Modbus server bound. CI mirrors this
  command via `.github/workflows/ci.yml`.

**PR1 docs**: README is NOT in PR1 (lands in PR3). PR body should describe
what landed: types, bus, scale-factor, unit tests, pnpm migration, ESLint
flat config, GitHub Actions CI, and explicitly call out that no
transport or protocol surface is in this PR.

**PR1 verification gate**: `pnpm lint && pnpm build && pnpm test` all
pass. CI runs on every PR via `.github/workflows/ci.yml`.

---

## PR2 — Modbus server, register constants, e2e test

**Branch**: `feat/modbus-server-registers` ← branches from `main`
after PR1 merges
**Estimated LOC**: ~400 (5 tasks, 5 commits)
**Independently mergeable**: yes — uses a `FakeAdapter` to drive the bus;
no HTTP, no real inverter.
**Verification gate**: `pnpm test` (unit + e2e) passes against the
running Modbus server. Adapter is stubbed.

> **Address convention note (verify against obs 575 before coding)**:
> HA reads `40000–40001` for the SunS magic, `40002–40003` for M1 ID/L,
> `40070–40071` for M101 ID/L, `40084` for M101.W. The e2e test must use
> these exact register addresses. Verify against the canonical SunSpec
> register map (obs 575) that `modbus-serial` v8 `ServerTCP` calls our
> handlers with `addr = register - 40000` (i.e., the magic is at
> handler offset `0`).

### 2.1 Register constants + write helpers
- [ ] 2.1 Add `src/modbus/sunspec-registers.ts` with the `M1` and `M101`
  `as const` blocks from design.md §5 (M1: ID=0, L=1, MN_START=2,
  MN_END=17, MD_START=18, MD_END=33, OPT_START=34, OPT_END=41,
  VR_START=42, VR_END=49, SN_START=50, SN_END=65, DA=66, PAD=67,
  LENGTH=68; M101: ID=70, L=71, A=72, PHVPHA=80, V_SF=83, W=84,
  W_SF=85, HZ=86, HZ_SF=87, WH_HI=94, WH_LO=95, WH_SF=96, DCW=101,
  ST=108, LENGTH=52).
- [ ] 2.2 Add module-level constants: `SUNS_MAGIC_HI = 0x5375` ('Su'),
  `SUNS_MAGIC_LO = 0x6e53` ('nS'), `EOM_SENTINEL = 0xffff`,
  `HOLDING_REGISTER_COUNT = 124` (offsets 0..123).
- [ ] 2.3 Add write helpers `writeUint16(buf, offset, value)`,
  `writeInt32BE(buf, offset, value)`, `writeSunSpecString(buf, offset,
  value, regCount)`. Inline-comment the BE byte order next to each helper.

**Commit**: `feat(modbus): add SunSpec M1+M101 register map and write helpers`.

### 2.2 Modbus server service
- [ ] 2.4 Add `src/modbus/sunspec-modbus-server.service.ts` —
  `SunSpecModbusServerService` with the double-buffer pattern from
  design.md §6: `bufA`, `bufB`, `active: 'A' | 'B'`,
  `getActive()`/`getInactive()`. `refreshFromBus(state)` writes the
  inactive buffer and atomically flips `active`.
- [ ] 2.5 Implement the `IServiceVector` handlers as Promise-returning
  methods: `getHoldingRegister`, `getMultipleHoldingRegisters`
  (reads from `getActive()`), `setRegister`/`setRegisterArray` throw
  `'read-only'`, `getInputRegister` returns 0, `setCoil` throws,
  `getCoil` returns false.
- [ ] 2.6 Implement `serveState(state: InverterState)` — projection
  from `InverterState` to register constants using scale-factor
  helpers from PR1. Writes SunS magic, M1 ID/L, M1 identity block
  (Mn/Md/SN), M101 ID/L, M101 dynamic block (A, PHVPHA, W, HZ, WH,
  DCW, ST) using the offsets from 2.1.
- [ ] 2.7 Implement `OnApplicationBootstrap` to start
  `new ServerTCP(vector, { host, port: 5020, unitID: 1 })`. Implement
  `OnApplicationShutdown` to close the server cleanly with a 5 s
  shutdown budget (per `devops-graceful-shutdown`).

**Commit**: `feat(modbus): add SunSpecModbusServerService with double-buffer + handlers`.

### 2.3 E2E test
- [ ] 2.8 Add `test/e2e/sunspec-modbus.e2e-spec.ts` — spawns the
  gateway with a `FakeAdapter` that publishes a known
  `InverterState`, then uses `modbus-serial` as a **client** to:
  read SunS magic at `40000–40001` (assert `0x5375`, `0x6e53`),
  read M1 ID/L at `40002–40003` (assert L=68), read M101 ID/L at
  `40070–40071` (assert L=52), read M101.W at `40084` + W_SF at
  `40085` (decode with `scaleFactor` and assert value matches the
  injected `InverterState.acPowerWatts`), read M101.ST at `40108`
  (assert `M101_ST.MPPT === 4`), read M101.WH_HI/LO at `40094–40095`
  (assert decoded kWh matches injected lifetime energy).
- [ ] 2.9 Add `jest-e2e.config.ts` and a `test:e2e` npm script.

**Commit**: `test(modbus): add e2e test against running SunSpecModbusServer`.

### 2.4 PR2 verification
- [ ] 2.10 Run `pnpm test:e2e`. All green. No real inverter needed
  (FakeAdapter injects the state). Server binds to localhost:5020 for
  the duration of the test only.

**PR2 docs**: PR description must link to the canonical SunSpec register
map (obs 575) and call out the address convention
(`handler offset = register - 40000`) used by `modbus-serial` v8.

**PR2 verification gate**: `npm run test:e2e` passes against the
running Modbus server. Adapter is stubbed.

---

## PR3 — Solplanet adapter, polling, module wiring, config, README

**Branch**: `feat/solplanet-adapter-module` ← branches from `main`
after PR1 merges (independent of PR2)
**Estimated LOC**: ~350 (9 tasks, 9 commits)
**Independently mergeable**: yes — full app boots, `/healthz` returns
200, cron is scheduled. Real inverter behavior is verified manually by
the user, NOT a CI gate.
**Verification gate**: `pnpm build` succeeds; `pnpm start:dev` boots
the app; `GET /healthz` returns `{ status: 'ok' }` with HTTP 200;
polling cron logs at debug level every 5 s when an inverter is
reachable.

### 3.1 Configuration loader
- [ ] 3.1 Add `src/config/configuration.ts` — typed env loader using
  `@nestjs/config`. Validates every port-valued key against
  `[1, 65535]` at boot. Out-of-range → exit `1` with a descriptive log
  line (per `configuration.md` spec). Defaults from design.md §10.

**Commit**: `feat(config): add typed env config with port validation`.

### 3.2 Solplanet HTTP CGI adapter
- [ ] 3.2 Add `src/gateway/inverters/solplanet-cgi.adapter.ts` —
  concrete `SolplanetCgiAdapter extends InverterAdapter`. Uses
  `@nestjs/axios` `HttpService` to GET
  `${INVERTER_BASE_URL}/getdevdata.cgi?device=${INVERTER_DEVICE_ID}&sn=${INVERTER_SN}`.
- [ ] 3.3 Field-name mapping from CGI payload to `InverterState`:
  `Pac → acPowerWatts`, `Vac → acVoltageVolts`, `Iac → acCurrentAmps`,
  `Fac → gridFrequencyHz`, `WH → lifetimeEnergyKwh`. Status codes from
  the inverter's `STATE` field mapped to `InverterStatus` (online →
  `MPPT`, sleeping → `SLEEPING`, fault → `FAULT`, unknown → `OFF`).
- [ ] 3.4 Wrap the HTTP call in a try/catch — on network error, JSON
  parse error, non-numeric value, or non-2xx response, return an
  **offline** `InverterState` (`isStale: true`, `operatingState: OFF`,
  zero production values, preserved identity). Adapter is contractually
  required NOT to throw (so the polling service can stay simple).
- [ ] 3.5 Inline document the Solplanet CGI response shape at the top
  of the file (link to obs 577).

**Commit**: `feat(adapter): add SolplanetCgiAdapter with offline-state fallback`.

### 3.3 Polling service
- [ ] 3.6 Add `src/gateway/inverter-polling.service.ts` —
  `@Injectable()` with `@Cron(CronExpression.EVERY_5_SECONDS)`. Injects
  `INVERTER_ADAPTER`, `InverterStateService`, and
  `SunSpecModbusServerService`. `handleTick()` calls
  `adapter.read()` → `bus.publish()` → `modbus.serveState()`.
  Wraps in try/catch + `Logger.warn` for belt-and-braces.

**Commit**: `feat(gateway): add InverterPollingService with 5s cron`.

### 3.4 Module wiring
- [ ] 3.7 Add `src/gateway/gateway.module.ts` — imports
  `HttpModule.register({ timeout: INVERTER_TIMEOUT_MS, maxRedirects: 0 })`
  and `ScheduleModule.forRoot()`. Providers: `InverterStateService`,
  `SunSpecModbusServerService`, `InverterPollingService`,
  `SolplanetCgiAdapter`, plus
  `{ provide: INVERTER_ADAPTER, useExisting: SolplanetCgiAdapter }`.
  Controllers: `HealthController`. Exports: `InverterStateService`,
  `SunSpecModbusServerService` (for potential future test harnesses).

**Commit**: `feat(gateway): wire GatewayModule with HttpModule + ScheduleModule`.

### 3.5 Health controller
- [ ] 3.8 Add `src/health/health.controller.ts` —
  `@Controller('healthz')` with `@Get()` returning `{ status: 'ok' }`.
  No deps, no auth — pure liveness probe.

**Commit**: `feat(health): add GET /healthz controller`.

### 3.6 App bootstrap
- [ ] 3.9 Add `src/app.module.ts` — imports
  `ConfigModule.forRoot({ isGlobal: true, load: [configuration] })` and
  `GatewayModule`. No global guards, no global pipes (gateway is
  internal-only, behind a private interface).
- [ ] 3.10 Add `src/main.ts` — `NestFactory.create(AppModule)`,
  `app.listen(HTTP_PORT)`. Reflect-metadata import at top.
  Graceful shutdown handlers (`app.enableShutdownHooks()`).

**Commit**: `feat(app): add AppModule and bootstrap entrypoint`.

### 3.7 README + env example
- [ ] 3.11 Add `.env.example` with the full schema from design.md §10
  (`INVERTER_BASE_URL`, `INVERTER_DEVICE_ID`, `INVERTER_SN`,
  `INVERTER_TIMEOUT_MS`, `MODBUS_HOST`, `MODBUS_PORT`, `MODBUS_UNIT_ID`,
  `STALE_AFTER_MS`, `SHUTDOWN_TIMEOUT_MS`, `HTTP_PORT`). Inline comment
  next to `MODBUS_HOST`: **must be a private interface in production**.
- [ ] 3.12 Add `README.md` covering: what the gateway is (1 paragraph
  + diagram), installation (`pnpm install --frozen-lockfile`),
  configuration (every `.env` key + private-interface warning), running
  (`pnpm start:dev`), how to verify with `pymodbus` (Python venv
  snippet from design.md §11), Home Assistant integration example
  with the **corrected** register addresses (`40002–40069` for M1,
  `40070–40121` for M101, SunS magic at `40000–40001`).

**Commit**: `docs: add README and .env.example with security note`.

### 3.8 PR3 verification
- [ ] 3.13 Run `pnpm build` — TypeScript compiles clean.
- [ ] 3.14 Run `pnpm start:dev` — service starts, `/healthz`
  returns 200, polling cron fires every 5 s at debug level
  (no real inverter means the adapter returns an offline state and
  the cron logs the warning). No real-inverter test required for CI.

**PR3 docs**: README is the user-facing doc; PR body links to it and
calls out the security note about binding to a private interface.

**PR3 verification gate**: app boots, `/healthz` returns 200, polling
cron is scheduled. Real inverter behavior is verified manually by the
user (NOT a CI gate).

---

## Merge sequence

GitHub Flow: every PR targets `main` directly. No parent chain.

1. Open **PR1** (`pr1/domain-state-scalefactor` → `main`). Review and
   merge to `main`. Foundation is now in `main`.
2. Branch `feat/modbus-server-registers` off `main`. Open **PR2**
   (`feat/modbus-server-registers` → `main`). Review and merge.
3. Branch `feat/solplanet-adapter-module` off `main`. Open **PR3**
   (`feat/solplanet-adapter-module` → `main`). Review and merge.

PR2 and PR3 are developed in parallel after PR1 lands; both depend on
PR1's `InverterState`, `InverterStateService`, `InverterAdapter`, and
scale-factor helpers being in `main`. They do NOT depend on each other.

## Workload summary

| PR | Tasks | Commits | Est LOC | Est review time |
|----|-------|---------|---------|------------------|
| PR1 | 12 | 12 | ~350 | 15–20 min |
| PR2 | 5 | 5 | ~400 | 20–25 min |
| PR3 | 9 | 9 | ~350 | 20–25 min |
| **Total** | **26** | **26** | **~1100** | **55–70 min** |

PR1 grew from 8→12 tasks because of the pnpm migration, ESLint setup,
and GitHub Actions CI. The added tasks (~80 LOC of config + workflow)
are infrastructure, not domain code, and stay under the per-PR review
budget when measured as code-only changes.

## Out of scope (deferred follow-up changes)

- Other inverter brands (Fronius, Sungrow, SMA). Adapter interface is
  defined up front in PR1 — second adapter is a focused follow-up.
- Three-phase inverters (SunSpec Model 103).
- Setpoint / power-control writes (read-only gateway for v1).
- Modbus TCP authentication / TLS.
- Daily-energy register (`DlyWH` from Model 103). HA computes daily
  totals from lifetime energy deltas.