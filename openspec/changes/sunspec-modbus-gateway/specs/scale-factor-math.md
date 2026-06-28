# Scale-Factor Math

## Purpose

Pure, side-effect-free logic that converts a floating-point engineering value
into the int16 scaled integer that SunSpec expects on the wire, together with
the matching scale factor (`SF`). Lives in a single module with no
dependencies on NestJS, the adapter, the state bus, or the Modbus server.
This module is what makes the gateway able to publish 4500 W and 230.5 V
without overflowing the int16 register range.

## ADDED Requirements

### Requirement: Scaled-value encoding

For every dynamic measurement the system MUST compute a SunSpec
`(value, scaleFactor)` pair such that `round(value × 10^scaleFactor)` fits in
the signed int16 range `[-32768, 32767]`. The function MUST default to `SF=0`
when in doubt and MUST downgrade `SF` (never upgrade past the value's natural
precision) when the scaled magnitude would exceed `32767`.

#### Scenario: 230.5 V with SF=-1 stores as 2305

- GIVEN the engineering value is `230.5` V
- WHEN `encode(230.5, 'V')` runs
- THEN the function returns `{ value: 2305, scaleFactor: -1 }`
- AND `2305 × 10^(-1) = 230.5`, matching the source value within 0.05 V

#### Scenario: 4500 W with SF=0 stores as 4500

- GIVEN the engineering value is `4500` W
- WHEN `encode(4500, 'W')` runs
- THEN the function returns `{ value: 4500, scaleFactor: 0 }`

#### Scenario: Value > 32767 downgrades SF (clips, never overflows int16)

- GIVEN the engineering value is `50000` V (would overflow int16 at SF=0)
- WHEN `encode(50000, 'V')` runs
- THEN the function returns `{ value: 5000, scaleFactor: 1 }` (i.e. `5000 × 10 = 50000`)
- AND `value ≤ 32767` so the int16 register does not overflow

### Requirement: Lifetime-energy encoding (int32 big-endian)

The system MUST encode `lifetimeEnergyKwh` as a 32-bit unsigned accumulator
across two consecutive holding registers, written big-endian (high word
first). The default `WH_SF` is `0`; only widen `WH_SF` to negative when the
value would exceed `2^32 - 1`.

#### Scenario: WH (lifetime energy) uses int32 BE, SF=0 with acc32 headroom

- GIVEN `lifetimeEnergyKwh=12345` kWh
- WHEN the server writes the WH register pair
- THEN registers `40094` = `0x3039` (high word, = 12345) and `40095` = `0x0000` (low word)
- AND `WH_SF` (40096) = `0`
- AND `2^32 - 1` kWh of headroom remains before any SF adjustment is needed

### Requirement: chooseScaleFactor helper

The system MUST export `chooseScaleFactor(value: number, maxAbs = 32767)` that
returns the SF (in `[-10, 10]`) that maximises precision without overflowing
int16. The function MUST return `-10` as a floor and `+10` as a ceiling even
when the value would still overflow at those bounds.

#### Scenario: chooseScaleFactor returns the SF that maximises precision without overflowing

- GIVEN the engineering value is `230.5`
- WHEN `chooseScaleFactor(230.5)` runs
- THEN it returns `-1` (since `230.5 × 10 = 2305` fits and `230.5 × 100 = 23050` also fits, but `-1` retains the fractional precision)
- AND `round(230.5 × 10^(-1)) = 2305`

#### Scenario: chooseScaleFactor clamps to floor when even SF=-10 overflows

- GIVEN the engineering value is `1e15`
- WHEN `chooseScaleFactor(1e15)` runs
- THEN it returns `-10`
- AND the resulting value is clipped (not NaN), giving Home Assistant a known-wrong reading rather than an exception

## Non-Goals

- This spec does NOT cover float32 register encoding (only int16 / int32).
- This spec does NOT cover string-register encoding (`Mn`, `Md`, `SN`) — those are handled by the Modbus server.
- This spec does NOT cover scale-factor persistence across restarts.