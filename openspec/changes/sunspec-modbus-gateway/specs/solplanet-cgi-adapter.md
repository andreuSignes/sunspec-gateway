# Solplanet CGI Adapter

## Purpose

Concrete `InverterAdapter` implementation for the Solplanet ASW H-S2 series.
Polls the inverter's HTTP CGI endpoint, parses the JSON response, normalises
the fields into an `InverterState`, and never throws — every transport
failure path returns an offline state instead. This adapter is the only one
shipping in v1; the interface is defined up front to keep the door open for
Fronius / Sungrow / SMA later.

## ADDED Requirements

### Requirement: Polling URL and cadence

The adapter MUST issue `GET <INVERTER_BASE_URL>/getdevdata.cgi?device=<DEVICE_ID>&sn=<SN>`
on every cron tick. The default poll interval is 5000 ms and MUST be
configurable via `POLL_INTERVAL_MS`. Any request that takes longer than
`POLL_TIMEOUT_MS` (default 3000) MUST be aborted and treated as an offline
response.

#### Scenario: Adapter polls every 5 seconds via @nestjs/schedule cron

- GIVEN the gateway runs with default configuration
- WHEN 30 seconds of wall-clock time elapse with the inverter responding in under 100 ms each call
- THEN the adapter issues exactly 6 HTTP GET requests to the CGI endpoint
- AND the interval between consecutive requests is between 4.9 s and 5.1 s

### Requirement: Field-name mapping and coercion

The adapter MUST map the CGI JSON payload to `InverterState` as follows. Any
field missing from the response MUST be coerced to `0`. Any field whose value
is not a finite number MUST be coerced to `0`. The adapter MUST coerce the
`St` field to `1` (OFF) when absent or non-numeric.

| CGI field | InverterState field |
|-----------|---------------------|
| `Pac` | `acPowerWatts` |
| `PhVphA` | `acVoltageVolts` |
| `A` | `acCurrentAmps` |
| `Hz` | `gridFrequencyHz` |
| `E-Total` | `lifetimeEnergyKwh` |
| `St` | `operatingState` (default `1` if absent or non-numeric) |

#### Scenario: Adapter returns offline state on HTTP 4xx/5xx without throwing

- GIVEN the inverter CGI returns HTTP 502
- WHEN `read()` is invoked
- THEN the promise resolves with `isStale=true`, `operatingState=OFF (1)`, every numeric field `0`
- AND the promise does NOT reject
- AND a single warn-level log line records the HTTP status

#### Scenario: Adapter returns offline state on JSON parse error

- GIVEN the inverter CGI returns HTTP 200 with a body that is not valid JSON
- WHEN `read()` is invoked
- THEN the promise resolves with `isStale=true`, `operatingState=OFF (1)`
- AND no exception escapes

#### Scenario: Adapter coerces non-numeric inverter responses to safe defaults

- GIVEN the inverter CGI returns `{"Pac": "N/A", "E-Total": null, "St": "FAULT"}`
- WHEN `read()` is invoked
- THEN `acPowerWatts=0`, `lifetimeEnergyKwh=0`, `operatingState=7` (FAULT per SunSpec enum)
- AND the promise resolves successfully

## Non-Goals

- This spec does NOT cover Modbus-TCP-direct communication with Solplanet hardware.
- This spec does NOT cover setpoint writes (`device=1` endpoint) or inverter configuration.
- This spec does NOT cover firmware upgrade flows.
- This spec does NOT cover inverter-side authentication beyond the `sn` query parameter.