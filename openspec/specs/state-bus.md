# InverterStateService (State Bus)

## Purpose

A NestJS-provided singleton that owns the latest `InverterState` and serves
it to every downstream consumer (primarily the SunSpec Modbus server). The bus
implements the double-buffer swap so concurrent reads never observe a
partially-written state, and it implements the stale-after-timeout policy so
downstream consumers never see stale production values silently.

## ADDED Requirements

### Requirement: Singleton lifecycle and API

The system MUST provide `InverterStateService` as a NestJS singleton with
exactly two public methods:

- `publish(state: InverterState): void` — adapter calls this on every poll result, including failures.
- `snapshot(): InverterState` — Modbus server calls this on every read; returns the current view.

The service MUST keep two internal buffers (`bufferA`, `bufferB`) and a
single `active` flag. `publish()` MUST always write to the inactive buffer
and then atomically swap the `active` flag. `snapshot()` MUST always read
from the currently-active buffer.

#### Scenario: State bus publishes new state on each successful poll

- GIVEN a fresh `InverterState` from the adapter with `isStale=false`, `acPowerWatts=4200`
- WHEN `publish(state)` is called
- THEN the very next call to `snapshot()` returns the new state with `acPowerWatts=4200`

### Requirement: Stale-after-timeout policy

The service MUST mark the published state `isStale=true` and
`operatingState=OFF (1)` if `snapshot()` is called more than `STALE_AFTER_MS`
milliseconds (default `30000`) after the last `publish()` with `isStale=false`.

The service MUST preserve the last successful numeric values
(`acPowerWatts`, `acVoltageVolts`, `acCurrentAmps`, `gridFrequencyHz`,
`lifetimeEnergyKwh`) when applying the stale marker.

#### Scenario: State bus marks state stale after 30 seconds without fresh data

- GIVEN the last successful publish was at `T0`
- WHEN `snapshot()` is called at `T0 + 30001` ms without an intervening `publish()` of a fresh state
- THEN the returned state has `isStale=true`, `operatingState=OFF (1)`, and production fields `0`
- AND `lifetimeEnergyKwh` equals the last successful value

#### Scenario: State bus preserves last-good state for downstream consumers

- GIVEN the last successful publish carried `lifetimeEnergyKwh=12345.6`
- AND a subsequent publish carried `isStale=true` with `lifetimeEnergyKwh=0`
- WHEN the Modbus server calls `snapshot()`
- THEN the returned state has `isStale=true` and `lifetimeEnergyKwh=12345.6`

## Non-Goals

- This spec does NOT cover persistence to disk or remote storage.
- This spec does NOT cover multi-inverter fan-out; one inverter per gateway for v1.
- This spec does NOT cover notification of stale transitions; the marker is read on demand.