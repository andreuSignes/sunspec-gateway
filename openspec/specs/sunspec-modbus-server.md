# SunSpec Modbus TCP Server

## Purpose

`SunSpecModbusServerService` exposes the latest `InverterState` over Modbus
TCP following the SunSpec Information Model. Home Assistant's built-in
SunSpec integration is the primary consumer. The server serves only Model 1
(Common) and Model 101 (Single-Phase Inverter) and is read-only.

## ADDED Requirements

### Requirement: Register map at boot

At boot the server MUST write a fixed SunSpec header into its register
buffer before opening the listening socket:

- `40000..40001`: SunSpec magic `0x5375 0x6E53` ("SunS").
- `40002`: Model 1 ID = `1`. `40003`: Model 1 L = `68`.
- `40070`: Model 101 ID = `101`. `40071`: Model 101 L = `52`.
- `40124`: end-of-models sentinel `0xFFFF`.
- `40004..40069` (M1 body) and `40072..40123` (M101 body) initialised to `0` and refreshed on every successful poll.

#### Scenario: Server writes SunS magic at registers 40000-40001 at boot

- GIVEN the server has finished initialising but no poll has yet completed
- WHEN a Modbus client reads holding registers at addresses 40000 and 40001
- THEN it receives `0x5375` and `0x6E53` respectively

#### Scenario: Server writes Model 1 ID, length, and identity strings correctly

- GIVEN any consumer
- WHEN it reads registers 40002 and 40003
- THEN it receives `1` and `68` respectively
- AND `40004..40019` yield `Mn` (32 chars, NUL-padded), `40020..40035` yield `Md`, `40052..40067` yield `SN`, `40068` yields `DA`, `40069` yields `Pad`

### Requirement: Dynamic Model 101 fields from InverterState

The server MUST refresh Model 101 dynamic fields on every successful adapter
poll by writing into the inactive double-buffer and atomically swapping it
into the read path.

| Field | Register | Scale-factor register |
|-------|----------|-----------------------|
| `A` | 40072 | `A_SF` @ 40076 |
| `PhVphA` | 40080 | `V_SF` @ 40083 (shared with `PPVphAB/BC/CA` @ 40077..40079) |
| `W` | 40084 | `W_SF` @ 40085 |
| `Hz` | 40086 | `Hz_SF` @ 40087 |
| `WH` (int32 BE) | 40094..40095 | `WH_SF` @ 40096 |
| `St` | 40108 | — |

#### Scenario: Server writes W, PhVphA, A, Hz, WH and their SFs from current InverterState

- GIVEN the state bus carries `acPowerWatts=4500`, `acVoltageVolts=230.5`, `acCurrentAmps=10.2`, `gridFrequencyHz=50.0`, `lifetimeEnergyKwh=12345`, `operatingState=4`
- WHEN a Modbus client reads holding registers across the M101 dynamic block
- THEN `W` (40084) encodes `4500` at `W_SF` (40085) = `0`, `PhVphA` (40080) encodes `2305` at `V_SF` (40083) = `-1`, `A` (40072) encodes `102` at `A_SF` (40076) = `-1`, `Hz` (40086) encodes `5000` at `Hz_SF` (40087) = `-2`
- AND `WH` (40094-40095) returns `12345` as int32 big-endian at `WH_SF` (40096) = `0`, `St` (40108) returns `4`

#### Scenario: Server uses double-buffer for atomic state swap

- GIVEN the Modbus server is mid-write of a 52-register M101 block into the inactive buffer
- WHEN a Modbus client issues a bulk read of the same block
- THEN the client either observes the entire pre-write block OR the entire post-write block
- AND never a torn read where some registers are old and others are new

#### Scenario: Server handles Promise-returning bulk reads

- GIVEN Home Assistant issues `getMultipleHoldingRegisters` covering M1 (`40002..40069`) and M101 (`40070..40123`) in two bulk calls
- WHEN the server's vector handler returns the snapshot
- THEN it returns a `Promise<number[]>` that resolves to the concatenated register array
- AND `modbus-serial` awaits the promise before serialising the Modbus response

### Requirement: Graceful shutdown

The server MUST implement `OnApplicationShutdown`. On shutdown it MUST close
the listening socket, reject any in-flight read with Modbus exception `0x0B`
(Gateway Target Device Failed to Respond), and complete within
`SHUTDOWN_TIMEOUT_MS` (default `5000`).

#### Scenario: Server stops cleanly on OnApplicationShutdown

- GIVEN the NestJS application receives `SIGTERM`
- WHEN the shutdown lifecycle runs
- THEN the Modbus TCP server stops accepting new connections within 100 ms
- AND all established sockets are closed within `SHUTDOWN_TIMEOUT_MS`

## Non-Goals

- This spec does NOT cover Modbus TLS or authentication.
- This spec does NOT cover setpoint or write registers (read-only gateway).
- This spec does NOT cover daily-energy registers (`DlyWH` from Model 103).
- This spec does NOT cover three-phase Model 103 or any model beyond 1 + 101.