import {
  applyScaleFactor,
  chooseScaleFactor,
  encode,
  splitAcc32,
} from '../../src/modbus/scale-factor';

describe('scale-factor', () => {
  describe('chooseScaleFactor', () => {
    // Inline unit cases reproduced verbatim from design.md §4.
    it.each<[number, number]>([
      [0, 0],
      [230.5, -1],
      [4500, 0],
      [50_000, 1], // downgrade — never overflow
      [1e15, -10], // clamp at SF floor
      [-100, 0],
      [-230.5, -1],
      [-32_767, 0],
    ])('chooses SF for %i → %i', (input, expected) => {
      expect(chooseScaleFactor(input)).toBe(expected);
    });

    it('returns 0 for non-finite input', () => {
      expect(chooseScaleFactor(NaN)).toBe(0);
      expect(chooseScaleFactor(Infinity)).toBe(0);
      expect(chooseScaleFactor(-Infinity)).toBe(0);
    });
  });

  describe('applyScaleFactor', () => {
    it('encodes 230.5V with SF=-1 as 2305', () => {
      expect(applyScaleFactor(230.5, -1)).toBe(2305);
    });
    it('encodes 4500W with SF=0 as 4500', () => {
      expect(applyScaleFactor(4500, 0)).toBe(4500);
    });
    it('encodes -100 with SF=0 as -100', () => {
      expect(applyScaleFactor(-100, 0)).toBe(-100);
    });
    it('rounds half-up', () => {
      expect(applyScaleFactor(230.55, -1)).toBe(2306); // rounds to nearest
    });
    it('clamps to int16 max on overflow', () => {
      expect(applyScaleFactor(1e9, 0)).toBe(32_767);
    });
    it('clamps to int16 min on underflow', () => {
      expect(applyScaleFactor(-1e9, 0)).toBe(-32_768);
    });
  });

  describe('encode', () => {
    it('encodes 230.5 with SF=-1 as { value: 2305, scaleFactor: -1 }', () => {
      expect(encode(230.5)).toEqual({ value: 2305, scaleFactor: -1 });
    });
    it('encodes 4500 with SF=0 as { value: 4500, scaleFactor: 0 }', () => {
      expect(encode(4500)).toEqual({ value: 4500, scaleFactor: 0 });
    });
    it('encodes 50000 (downgrade) as { value: 5000, scaleFactor: 1 }', () => {
      expect(encode(50_000)).toEqual({ value: 5000, scaleFactor: 1 });
    });
    it('clamps 1e15 to int16 max with SF=-10', () => {
      expect(encode(1e15)).toEqual({ value: 32_767, scaleFactor: -10 });
    });
    it('encodes 0 as { value: 0, scaleFactor: 0 }', () => {
      expect(encode(0)).toEqual({ value: 0, scaleFactor: 0 });
    });
    it('encodes -100 with SF=0 as { value: -100, scaleFactor: 0 }', () => {
      expect(encode(-100)).toEqual({ value: -100, scaleFactor: 0 });
    });
    it('encodes NaN as { value: 0, scaleFactor: 0 }', () => {
      expect(encode(NaN)).toEqual({ value: 0, scaleFactor: 0 });
    });
  });

  describe('splitAcc32', () => {
    it('splits 0 into { hi: 0, lo: 0 }', () => {
      expect(splitAcc32(0)).toEqual({ hi: 0, lo: 0 });
    });
    it('splits 0x12345678 into { hi: 0x1234, lo: 0x5678 }', () => {
      expect(splitAcc32(0x1234_5678)).toEqual({ hi: 0x1234, lo: 0x5678 });
    });
    it('splits 12345 into { hi: 0, lo: 12345 } (BE: high register = upper 16 bits = 0)', () => {
      // 12345 = 0x00003039 fits in 16 bits, so the upper 16-bit word is 0
      // and the lower 16-bit word holds the value.
      expect(splitAcc32(12345)).toEqual({ hi: 0, lo: 12345 });
    });
    it('splits 0xCAFE_BABE into { hi: 0xCAFE, lo: 0xBABE }', () => {
      expect(splitAcc32(0xcafe_babe)).toEqual({ hi: 0xcafe, lo: 0xbabe });
    });
    it('coerces negative input to uint32 (all-ones hi+lo)', () => {
      // `-1 >>> 0` is `0xFFFFFFFF`, which splits to all-ones hi+lo.
      expect(splitAcc32(-1)).toEqual({ hi: 0xffff, lo: 0xffff });
    });
    it('truncates values above 0xFFFFFFFF to lower 32 bits', () => {
      // `0x1_0000_0000 >>> 0` is `0`, which splits to {hi:0, lo:0}.
      expect(splitAcc32(0x1_0000_0000)).toEqual({ hi: 0, lo: 0 });
    });
    it('returns 0xFFFFFFFF as { hi: 0xffff, lo: 0xffff }', () => {
      expect(splitAcc32(0xffff_ffff)).toEqual({ hi: 0xffff, lo: 0xffff });
    });
  });
});