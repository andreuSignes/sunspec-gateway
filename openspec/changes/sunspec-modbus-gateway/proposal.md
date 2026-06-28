# Proposal: SunSpec Modbus Gateway

## 1. Intent

A NestJS microservice that polls a Solplanet ASW H-S2 inverter over HTTP CGI
(`/getdevdata.cgi?device=2&sn=<SN>`), normalizes the response into an internal
`InverterState`, and re-exposes it as a standard Modbus TCP server implementing
SunSpec Models 1 (Common) and 101 (Single-Phase Inverter). Home Assistant's
built-in SunSpec integration can then poll the gateway natively and surface
solar power, voltage, current, frequency, lifetime energy, and operating state
as first-class sensors — no custom component required.

**Success criterion**: Home Assistant polls the gateway on port 5020, reads
Model 1 + Model 101 in two bulk reads, applies the gateway's scale factors, and
displays correct DC watts, AC watts, AC/DC voltages, AC current, frequency, and
lifetime kWh within one polling cycle of the inverter.

## 2. Scope

### In scope

- Solplanet HTTP CGI adapter (`SolplanetAdapter` implementing `InverterAdapter`)
- In-memory state bus with double-buffer for atomic swap
- SunSpec Modbus TCP server (port 5020, configurable bind address) implementing
  Model 1 (L=68) + Model 101 (L=52)
- Bulk register reads via `getMultipleHoldingRegisters`
- Per-measurement dynamic scale-factor selection with int16 overflow guard
- Stale-data policy: zero production values, set `St=OFF` after 30s without a
  fresh poll response
- NestJS `@nestjs/schedule` 5s polling cron
- Configuration via `.env` (inverter host, inverter serial, Modbus bind address
  and port, poll interval, stale threshold)
- Verification harness using `pymodbus` client (executed in `sdd-verify`)

### Out of scope

- Other inverter brands (Fronius, Sungrow, SMA, etc.). Adapter interface is
  defined up front; second adapter is a focused follow-up change.
- Three-phase inverters (would require SunSpec Model 103). Single-phase only
  for v1.
- Setpoint / power-control writes. Read-only gateway.
- Modbus TCP authentication / TLS. Bind to a private LAN interface only;
  warning documented in README.
- Daily-energy register (`DlyWH` from Model 103). Home Assistant computes daily
  totals from lifetime energy deltas.

## 3. Approach

```
┌────────────────────┐   poll (5s)   ┌──────────────┐   bulk read   ┌─────────────────────────┐
│ Solplanet HTTP CGI │ ────────────► │  State Bus   │ ◄──────────── │ SunSpec Modbus TCP      │
│ InverterAdapter    │               │ (double-buf) │              │ Server (port 5020)      │
└────────────────────┘               └──────────────┘              └─────────────────────────┘
       Adapter                          Domain core                       Protocol surface
```

The three layers are decoupled by `InverterAdapter` (swap transports: HTTP,
Modbus, MQTT) and the typed `StateBus` (swap the wire protocol: Modbus, MQTT,
REST). Replacing Solplanet with Fronius means writing a new `Adapter`; replacing
SunSpec Modbus with MQTT means writing a new transport layer. Neither change
touches the domain core. This mirrors the layering proven by
[`evcc-io/evcc`](https://github.com/evcc-io/evcc).

### Key technical decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Modbus server lib | `node-modbus-serial` v8.0.25 `ServerTCP` with `IServiceVector` | Battle-tested, Promise-based async handlers, supports bulk `getMultipleHoldingRegisters` |
| Default Modbus port | 5020 (configurable) | Non-privileged, container-friendly, no root required |
| Poll cadence | 5s via `@nestjs/schedule` cron | Home Assistant polls ~10s; 2× overlap caps staleness at 5s; below inverter CGI saturation threshold |
| Scale factors | Dynamic per measurement, clamped to `[-10, +10]` (int16 overflow guard) | Prevents SF wraparound on edge values |
| State buffer | Double-buffer with atomic pointer swap (`BufferA`, `BufferB`, `active` flag) | Eliminates torn reads when adapter write and Modbus read race |
| Register reads | Bulk via `getMultipleHoldingRegisters` — M1 in one read, M101 in one read | Cuts Home Assistant's initial scan from N round-trips to 2 |
| Stale-data policy | Zero production values, set `St=OFF` after 30s without fresh data | Prevents HA from logging phantom power; signals fault cleanly |
| SunSpec register map | Pinned from `github.com/sunspec/models` (M1 L=68, M101 L=52, shared `V_SF` @ +13) | Canonical source; matches `ha-sunspec` expectations |

## 4. Cross-references to authoritative sources

- **SunSpec Model 1 + 101 JSON**: https://github.com/sunspec/models/blob/master/json/model_101.json
- **node-modbus-serial**: https://github.com/yaacov/node-modbus-serial
- **Home Assistant SunSpec community integration** (peer ergonomics): https://github.com/CJNE/ha-sunspec
- **pymodbus** (verify harness only, not runtime): https://github.com/pymodbus-dev/pymodbus
- **Architecture peer** (Adapter → StateBus → API): https://github.com/evcc-io/evcc
- **Discovery / scan pattern**: https://github.com/volkszaehler/mbmd
- **Security note** (bind private interface in prod): https://github.com/MartijnVdS/pv2mqtt

## 5. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Solplanet CGI returns non-numeric values during inverter fault | High | `0xFFFF` (`NaN`) sentinel at the adapter boundary; `St=FAULT` propagates to Home Assistant |
| Torn reads between adapter write and Modbus server read | Med | Double-buffer with atomic pointer swap |
| `modbus-serial` optional `serialport@13` native build fails in CI | Med | `.npmrc` with `optional=false`; TCP-only path works without native deps |
| Node 20+ requirement breaks older container images | Low | Pin `engines.node: ">=20.0.0"` in `package.json`; document in README |
| Polling cadence mismatch with Home Assistant | Med | 5s adapter poll vs ~10s Home Assistant read cadence → 2× overlap guarantees freshness |
| Only Solplanet inverter supported initially | High | Adapter interface defined up front; second adapter is a focused follow-up change |
| Modbus TCP accidentally exposed on `0.0.0.0` in production | Med | Default `MODBUS_BIND_ADDRESS=0.0.0.0` only for dev; README warns to bind private interface in prod |

## 6. Alternatives considered

| Alternative | Pros | Cons |
|-------------|------|------|
| Talk Modbus directly to the Solplanet inverter (skip gateway) | No extra process; native interface | Solplanet's native Modbus map is undocumented and proprietary; high reverse-engineering cost; ties HA to one vendor |
| Bridge via `node-red-contrib-sunspec` | Less custom code | Node-RED runtime overhead for a single-purpose gateway; harder to test, harder to containerize |
| Ship as a Home Assistant OS add-on | Zero external infrastructure; lifecycle managed by HA | Couples gateway to HA; ties one inverter brand to HA's release cycle |
| Write a custom HA integration instead of serving SunSpec | Skip the Modbus server | Reinvents what Home Assistant's built-in SunSpec integration already does; loses out-of-the-box Energy dashboard support |

## 7. Review budget forecast

- **Target**: ≤ 400 changed lines for the full implementation to fit a single
  PR (preflight D1).
- **Estimated breakdown**:

  | Module | Lines |
  |--------|-------|
  | `SolplanetAdapter` (HTTP client + parsing + normalization) | ~80 |
  | `StateBus` (double-buffer + atomic swap) | ~50 |
  | `SunSpecModbusServer` (M1 + M101 register layout + handlers) | ~150 |
  | `scaleFactor.ts` helper | ~30 |
  | `AppModule` + DI wiring + `.env` config | ~40 |
  | Tests + `pymodbus` verify harness | ~50 |
  | **Total** | **~400** |

- If `sdd-tasks` forecasts higher, the orchestrator will trigger the review
  workload guard and split into chained PRs (per preflight C1 / `chained-pr`
  skill). Recommended split order: `SunSpecModbusServer` first with a
  fixture-driven fake adapter, then `SolplanetAdapter` against the real
  inverter.