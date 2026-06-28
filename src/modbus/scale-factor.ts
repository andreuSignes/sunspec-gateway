/**
 * SunSpec scale-factor math.
 *
 * value_actual = raw_int16 × 10^SF
 *
 * We pick the SF that maximises precision while keeping |raw| ≤ 32767.
 * All register writes use big-endian encoding per SunSpec convention.
 */

/** SunSpec int16 range. */
const INT16_MAX = 32767;
const INT16_MIN = -32768;
/** SF floor: never choose an SF below this even if it would still overflow. */
const SF_FLOOR = -10;
/** SF ceiling: never choose an SF above this. */
const SF_CEIL = 10;

export interface Encoded {
  readonly value: number;
  readonly scaleFactor: number;
}

/**
 * Pick the SF that maximises precision without overflowing signed int16.
 *
 * Strategy:
 * - Whole numbers (no fractional part) prefer SF=0 — no precision loss
 *   and no downgrade. If the value overflows at SF=0, walk positive SFs
 *   (downgrade precision) until it fits or we hit SF_CEIL.
 * - Fractional values prefer the most-negative SF that fits — that
 *   preserves as many decimal places as possible.
 * - If even SF_CEIL (positive side) or SF_FLOOR (negative side) fails,
 *   the value is clamped to the floor; applyScaleFactor will then clip
 *   the raw to INT16_MAX.
 */
export function chooseScaleFactor(value: number, maxAbs: number = INT16_MAX): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.abs(value);
  if (abs === 0) return 0;

  const isInteger = Number.isInteger(abs);

  if (isInteger) {
    if (abs <= maxAbs) return 0;
    for (let sf = 1; sf <= SF_CEIL; sf++) {
      if (abs * Math.pow(10, -sf) <= maxAbs) return sf;
    }
    return SF_FLOOR;
  }

  // Fractional: walk negative SFs (most precision first).
  for (let sf = -1; sf >= SF_FLOOR; sf--) {
    if (abs * Math.pow(10, -sf) <= maxAbs) return sf;
  }
  return SF_FLOOR;
}

/**
 * Apply SF to an engineering value, clamp into int16 range.
 *
 * `raw = round(value × 10^(-sf))` — the negative exponent recovers the
 * raw register value (e.g. 230.5 V with SF=-1 → 2305).
 */
export function applyScaleFactor(value: number, sf: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = Math.round(value * Math.pow(10, -sf));
  if (scaled > INT16_MAX) return INT16_MAX;
  if (scaled < INT16_MIN) return INT16_MIN;
  return scaled;
}

/** One-shot: pick SF and apply. */
export function encode(value: number): Encoded {
  const sf = chooseScaleFactor(value);
  return { value: applyScaleFactor(value, sf), scaleFactor: sf };
}

/** Split an unsigned 32-bit value into hi (offset+0) and lo (offset+1) uint16, big-endian. */
export function splitAcc32(value: number): { readonly hi: number; readonly lo: number } {
  const v = value >>> 0; // coerce to uint32
  const hi = (v >>> 16) & 0xffff;
  const lo = v & 0xffff;
  return { hi, lo };
}