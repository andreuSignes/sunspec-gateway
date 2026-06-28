# InverterState Domain Entity

## Purpose

The canonical in-memory representation of the inverter at a single point in
time. The adapter produces it, the state bus publishes it, and the Modbus
server reads it. `InverterState` is the single contract between the three
layers of the gateway. This spec defines every field, its units, its source,
and its expected range. It also defines how the state behaves when polls fail
or when the bus has no fresh data.

## ADDED Requirements

### Requirement: InverterState field shape

The system MUST model `InverterState` as an immutable TypeScript object with
the following fields. Every numeric field uses SI base units. `isStale` and
`lastUpdatedAt` are always present and are maintained by the state bus, never
the adapter.

| Field | Unit | Source | Expected range |
|-------|------|--------|----------------|
| `acPowerWatts` | W | Adapter (`Pac`) | `0` .. `15000` |
| `acVoltageVolts` | V | Adapter (`PhVphA`) | `0` .. `300` |
| `acCurrentAmps` | A | Adapter (`A`) | `0` .. `100` |
| `gridFrequencyHz` | Hz | Adapter (`Hz`) | `45` .. `65` |
| `lifetimeEnergyKwh` | kWh | Adapter (`E-Total`) | `0` .. `2^31 - 1` (int32 BE) |
| `operatingState` | enum (1..8) | Adapter (`St`) | SunSpec `St` enum |
| `vendorName` | string | Adapter static | ≤ 32 chars, NUL-padded |
| `modelName` | string | Adapter static | ≤ 32 chars, NUL-padded |
| `serialNumber` | string | Config (`INVERTER_SN`) | ≤ 32 chars, NUL-padded |
| `isStale` | boolean | State bus | `true` if no fresh poll in `> 30000` ms |
| `lastUpdatedAt` | ms epoch | State bus | monotonically non-decreasing on success |

#### Scenario: InverterState is constructed with sane defaults on cold start

- GIVEN the gateway has just booted and no poll has completed yet
- WHEN any consumer reads from the state bus
- THEN the bus returns an `InverterState` with every numeric field set to `0`, `isStale=true`, `operatingState=OFF (1)`, and `lastUpdatedAt=0`

### Requirement: InverterState is marked stale after 30 seconds without fresh data

The state bus MUST mark the published state `isStale=true` and
`operatingState=OFF (1)` when `snapshot()` is called more than 30000 ms after
the last successful publish. The bus MUST preserve the last successful
`lifetimeEnergyKwh` value while applying the stale marker.

#### Scenario: InverterState is marked stale when no fresh data for more than 30 seconds

- GIVEN a successful poll completed at `T0` with `lifetimeEnergyKwh=12345.6`, `isStale=false`
- WHEN the state bus serves a snapshot at `T0 + 30001` ms without an intervening successful publish
- THEN the snapshot has `isStale=true`, `operatingState=OFF (1)`, and all production numeric fields set to `0`
- AND the snapshot retains `lifetimeEnergyKwh=12345.6`

#### Scenario: InverterState preserves last-good lifetimeEnergyKwh when a poll fails

- GIVEN the previous successful poll set `lifetimeEnergyKwh=12345.6` and `isStale=false`
- WHEN the next adapter poll returns an offline state (HTTP 4xx/5xx, parse error, or timeout)
- THEN the bus publishes a new state where `lifetimeEnergyKwh` remains `12345.6`
- AND `isStale=true`, `operatingState=OFF (1)`, and every other production numeric field is `0`

## Non-Goals

- This spec does NOT cover daily-energy exposure (`DlyWH`).
- This spec does NOT cover three-phase fields (`PPVphBC`, `PPVphCA`).
- This spec does NOT cover firmware revision, DC string telemetry, or cabinet temperature.
- This spec does NOT cover persistence to disk; the state is in-memory only.