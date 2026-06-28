/**
 * SunSpec scale factor math.
 *
 * value_actual = raw_int16 × 10^SF
 *
 * We pick the SF that maximizes precision while keeping |raw| ≤ 32767.
 * All register writes use big-endian encoding per SunSpec convention.
 */

/** Choose the SF that keeps the raw value within int16 range. */
export function chooseScaleFactor(value: number): number {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs === 0) return 0;
  if (abs <= 32_767) return 0;
  if (abs <= 327_670) return -1;
  if (abs <= 3_276_700) return -2;
  return 0;
}

/** Apply the scale factor to produce an int16-safe raw value. */
export function applyScaleFactor(value: number, sf: number): number {
  const raw = Math.round(value * Math.pow(10, -sf));
  return clampInt16(raw);
}

/** Clamp a number to int16 range. */
export function clampInt16(n: number): number {
  if (n > 32_767) return 32_767;
  if (n < -32_768) return -32_768;
  return n;
}

/**
 * SunSpec `acc32` is a 32-bit unsigned counter stored across two 16-bit
 * registers in big-endian order (high word first).
 * Returns [highWord, lowWord].
 */
export function splitAcc32(value: number): [number, number] {
  const safe =
    value < 0 ? 0 : value > 0xffff_ffff ? 0xffff_ffff : value;
  const high = (safe >>> 16) & 0xffff;
  const low = safe & 0xffff;
  return [high, low];
}
