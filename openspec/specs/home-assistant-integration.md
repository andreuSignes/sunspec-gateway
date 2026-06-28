# Home Assistant Integration

## Purpose

Defines the Home Assistant `configuration.yaml` snippet that connects the
built-in SunSpec integration to the gateway, and the exact SunSpec register
addresses HA polls. This is the integration boundary: once HA reads the
register addresses below, the gateway is invisible — HA talks SunSpec.

## ADDED Requirements

### Requirement: configuration.yaml snippet

The following snippet MUST be documented in the project README and MUST be
the only HA-side configuration required:

```yaml
modbus:
  - name: solplanet_gateway
    type: tcp
    host: !secret gateway_host
    port: 5020
    sensors:
      - name: "Solar AC Power"
        slave: 1
        address: 40084
        input_type: holding
        data_type: int16
        scale: 0
        unit_of_measurement: "W"
        device_class: power
        state_class: measurement
      - name: "Solar Lifetime Energy"
        slave: 1
        address: 40094
        input_type: holding
        data_type: uint32
        count: 2
        scale: 0
        unit_of_measurement: "kWh"
        device_class: energy
        state_class: total_increasing
```

#### Scenario: HA reads register 40000-40001 and detects SunS magic

- GIVEN HA's built-in SunSpec integration has just been added with the configuration above
- WHEN HA scans the holding registers starting at address 40000
- THEN HA detects the SunSpec magic word `0x5375 0x6E53` at 40000-40001
- AND HA proceeds to discover Model 1 starting at 40002

#### Scenario: HA reads Model 1 starting at 40002 and extracts Mn, Md, SN

- GIVEN HA has discovered Model 1 at address 40002 with L=68
- WHEN HA reads holding registers 40002..40069
- THEN HA extracts `Mn` (vendor name) from 40004..40019, `Md` (model name) from 40020..40035, `SN` (serial number) from 40052..40067
- AND HA surfaces the gateway as a SunSpec-compliant inverter in its device registry

#### Scenario: HA reads W, PhVphA, A, Hz, WH with their SF registers

- GIVEN HA has finished Model 1 discovery
- WHEN HA reads the dynamic Model 101 fields
- THEN HA reads `W` (40084) at `W_SF` (40085), `PhVphA` (40080) at `V_SF` (40083), `A` (40072) at `A_SF` (40076), `Hz` (40086) at `Hz_SF` (40087)
- AND HA reads `WH` as a 32-bit big-endian accumulator across 40094-40095 at `WH_SF` (40096)
- AND every value HA surfaces to its Energy dashboard equals the inverter's reported value within the resolution implied by the matching scale factor

### Requirement: Documented discovery address set

The README MUST list the discovery address set HA polls as `[40000, 40002, 40070, 40124]` (SunS magic, M1 ID, M101 ID, end-of-models sentinel). This MUST match the gateway's actual register layout byte-for-byte.

#### Scenario: HA discovery completes without "unknown model" warnings

- GIVEN the gateway is running with default configuration
- WHEN HA scans the discovery address set
- THEN no warning is logged about unknown models or out-of-range registers
- AND the HA device registry shows the gateway as a SunSpec-compliant single-phase inverter

## Non-Goals

- This spec does NOT cover three-phase register exposure (Model 103).
- This spec does NOT cover daily-energy registers (`DlyWH`); HA computes daily totals from `WH` deltas.
- This spec does NOT cover setpoint / power-control writes; the gateway is read-only.
- This spec does NOT cover Modbus TLS — the README MUST warn operators to bind the gateway to a private LAN interface only.