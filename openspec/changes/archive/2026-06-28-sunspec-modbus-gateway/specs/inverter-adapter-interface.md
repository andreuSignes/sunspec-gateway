# InverterAdapter Interface

## Purpose

The transport-agnostic contract every inverter integration MUST satisfy. The
adapter's only job is to translate raw vendor output into an `InverterState`
without ever throwing. The state bus consumes the result; the Modbus server
never talks to an adapter directly. This decoupling is what lets a future
Fronius, Sungrow, or SMA integration slot in without touching the domain core
or the protocol surface.

## ADDED Requirements

### Requirement: InverterAdapter interface and DI token shape

The system MUST define `InverterAdapter` as a TypeScript interface with the
following members:

- `readonly vendorName: string` — written to SunSpec Model 1 `Mn`.
- `readonly modelName: string` — written to SunSpec Model 1 `Md`.
- `read(): Promise<InverterState>` — single async read of current state.

The system MUST export a NestJS DI token `INVERTER_ADAPTER` and bind the
concrete implementation (e.g. `SolplanetAdapter`) to it inside the inverter
feature module. No other module may import the concrete class directly.

#### Scenario: Adapter implementations never throw on transient errors

- GIVEN any well-typed `InverterAdapter` implementation
- WHEN the underlying transport returns a 4xx/5xx HTTP response, a network timeout, a malformed payload, or any other transport-level failure
- THEN `read()` MUST return a resolved `Promise<InverterState>` with `isStale=true` and `operatingState=OFF (1)`
- AND MUST NOT reject the promise under any circumstance short of a programmer-error type assertion failure

#### Scenario: Adapter returns stale-marked state on HTTP timeout

- GIVEN the underlying transport takes longer than the configured request timeout to respond
- WHEN `read()` is invoked
- THEN it resolves with `isStale=true`, `operatingState=OFF (1)`, every production numeric field set to `0`, and `lastUpdatedAt` unchanged from the previous successful read

#### Scenario: Adapter vendorName and modelName feed SunSpec Model 1 Mn and Md

- GIVEN a concrete adapter reports `vendorName="SOLPLANET"` and `modelName="ASW3000H-S2"`
- WHEN the state bus publishes the resulting `InverterState`
- THEN the Modbus server MUST write `"SOLPLANET"` into SunSpec Model 1 `Mn` (registers 40004..40019, 32 chars NUL-padded) and `"ASW3000H-S2"` into `Md` (registers 40020..40035, 32 chars NUL-padded)

## Non-Goals

- This spec does NOT define caching, batching, or write-back behaviour.
- This spec does NOT cover setpoint or control-plane adapters.
- This spec does NOT cover multi-inverter adapters; one adapter instance per gateway for v1.