# Configuration

## Purpose

Defines the `.env` schema the gateway reads at boot and the `ConfigService`
access patterns every module MUST use. Centralising config here keeps the
adapter, state bus, Modbus server, and schedule cron free of `process.env`
reads and gives `sdd-verify` a single place to inject test overrides.

## ADDED Requirements

### Requirement: Inverter configuration keys

The system MUST read the following keys from the environment (via
`@nestjs/config`) and expose them through a typed `ConfigService`:

| Key | Default | Validation |
|-----|---------|------------|
| `INVERTER_BASE_URL` | `http://192.168.1.50` | non-empty, must parse as a URL |
| `INVERTER_DEVICE_ID` | `2` | integer in `[1, 247]` |
| `INVERTER_SN` | empty (required) | non-empty, ≤ 32 chars |
| `POLL_INTERVAL_MS` | `5000` | integer in `[1000, 60000]` |
| `POLL_TIMEOUT_MS` | `3000` | integer in `[100, 30000]` |

#### Scenario: ConfigService loads INVERTER_BASE_URL, INVERTER_DEVICE_ID, INVERTER_SN with sane defaults

- GIVEN the `.env` file is missing or only contains `INVERTER_SN=ABC123`
- WHEN the gateway boots
- THEN `INVERTER_BASE_URL` resolves to `http://192.168.1.50`, `INVERTER_DEVICE_ID` resolves to `2`, and `POLL_INTERVAL_MS` resolves to `5000`
- AND the gateway starts without throwing

### Requirement: Modbus server configuration keys

| Key | Default | Validation |
|-----|---------|------------|
| `MODBUS_BIND_ADDRESS` | `0.0.0.0` | IPv4 or IPv6 literal |
| `MODBUS_PORT` | `5020` | integer in `[1, 65535]` |
| `MODBUS_UNIT_ID` | `1` | integer in `[1, 247]` |
| `STALE_AFTER_MS` | `30000` | integer in `[5000, 300000]` |
| `SHUTDOWN_TIMEOUT_MS` | `5000` | integer in `[1000, 30000]` |

#### Scenario: ConfigService loads MODBUS_HOST, MODBUS_PORT, MODBUS_UNIT_ID with sane defaults

- GIVEN no Modbus-related keys are present in the environment
- WHEN the gateway boots
- THEN `MODBUS_BIND_ADDRESS` resolves to `0.0.0.0`, `MODBUS_PORT` resolves to `5020`, `MODBUS_UNIT_ID` resolves to `1`

### Requirement: Port validation

`ConfigService` MUST validate every port-valued key against the inclusive
range `[1, 65535]` at boot time. Out-of-range values MUST cause the gateway
to exit non-zero with a descriptive log line.

#### Scenario: ConfigService rejects invalid port (must be 1-65535)

- GIVEN `MODBUS_PORT=99999` is present in the environment
- WHEN the gateway boots
- THEN it exits with status code `1`
- AND logs an error explaining that `MODBUS_PORT` must be in `[1, 65535]`

#### Scenario: ConfigService rejects zero and negative ports

- GIVEN `MODBUS_PORT=0` is present in the environment
- WHEN the gateway boots
- THEN it exits with status code `1`

## Non-Goals

- This spec does NOT cover runtime config reload (gateway restart required).
- This spec does NOT cover secret management beyond `INVERTER_SN`; the gateway is otherwise unauthenticated by design.
- This spec does NOT cover TLS configuration (no Modbus TLS in v1).