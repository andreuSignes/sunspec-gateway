# Polling Schedule

## Purpose

Defines the cron-driven background loop that drives the adapter every five
seconds, publishes the result to the state bus, and triggers the Modbus
server's double-buffer swap. The schedule is the heartbeat of the gateway:
it is the only place where time advances the system.

## ADDED Requirements

### Requirement: Cron tick configuration

The system MUST use `@nestjs/schedule` with the `@Cron(CronExpression.EVERY_5_SECONDS)`
decorator on a dedicated `PollingService.handleTick()` method. The method
MUST be the only caller of `INVERTER_ADAPTER.read()` and the only caller of
`InverterStateService.publish()`.

#### Scenario: Schedule uses @nestjs/schedule @Cron(EVERY_5_SECONDS)

- GIVEN the gateway is running with default config
- WHEN 30 seconds of wall-clock time elapse
- THEN `handleTick()` is invoked exactly 6 times
- AND the interval between consecutive invocations is between 4.9 s and 5.1 s

### Requirement: Crash-free polling loop

`handleTick()` MUST catch every error from `INVERTER_ADAPTER.read()` and
`InverterStateService.publish()` at the method boundary. A thrown error MUST
be logged at warn level and MUST NOT propagate to `@nestjs/schedule` (which
would otherwise tear down the schedule).

#### Scenario: Schedule continues running on adapter errors (no crash)

- GIVEN the first three adapter polls succeed and the fourth throws a synchronous exception
- WHEN the next 30 seconds elapse
- THEN the schedule continues to fire on its 5-second cadence
- AND a warn-level log line records the exception
- AND no `@nestjs/schedule` lifecycle event is emitted

### Requirement: Publish and refresh contract

On every successful tick the schedule MUST, in this order:

1. Call `INVERTER_ADAPTER.read()` and await the result.
2. Call `InverterStateService.publish(result)`.
3. Call `SunSpecModbusServerService.refreshFromBus()` which atomically swaps the new state into the Modbus read path.

The three calls MUST be sequential (no concurrency) so the swap always
reflects a fully-written buffer.

#### Scenario: Schedule publishes new state to bus and triggers Modbus refresh on success

- GIVEN a successful poll returns `acPowerWatts=4200`
- WHEN `handleTick()` completes
- THEN `InverterStateService.snapshot()` returns the new state with `acPowerWatts=4200`
- AND the next Modbus read of register 40084 (W) returns the encoded value `4200` with `W_SF=0`

## Non-Goals

- This spec does NOT cover multi-cadence polling (one cadence for v1).
- This spec does NOT cover jitter / randomisation of the tick (deterministic 5 s).
- This spec does NOT cover pause / resume API for maintenance windows.