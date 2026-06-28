import {
  applyScaleFactor,
  chooseScaleFactor,
  clampInt16,
  splitAcc32,
} from '../../src/modbus/scale-factor';

describe('scale-factor', () => {
  describe('chooseScaleFactor', () => {
    it.each([
      [0, 0],
      [230.5, 0],
      [4500, 0],
      [-1500, 0],
      [32_767, 0],
      [32_768, -1],
      [230_000, -1],
      [1_234_567, -2],
    ])('chooses SF for %i → %i', (input, expected) => {
      expect(chooseScaleFactor(input)).toBe(expected);
    });

    it('returns 0 for non-finite input', () => {
      expect(chooseScaleFactor(NaN)).toBe(0);
      expect(chooseScaleFactor(Infinity)).toBe(0);
    });
  });

  describe('applyScaleFactor', () => {
    it('encodes 230.5V with SF=-1 as 2305', () => {
      expect(applyScaleFactor(230.5, -1)).toBe(2305);
    });
    it('encodes 4500W with SF=0 as 4500', () => {
      expect(applyScaleFactor(4500, 0)).toBe(4500);
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

  describe('clampInt16', () => {
    it('passes through values in range', () => {
      expect(clampInt16(0)).toBe(0);
      expect(clampInt16(32_767)).toBe(32_767);
      expect(clampInt16(-32_768)).toBe(-32_768);
    });
    it('clamps overflow', () => {
      expect(clampInt16(32_768)).toBe(32_767);
      expect(clampInt16(-32_769)).toBe(-32_768);
    });
  });

  describe('splitAcc32', () => {
    it('splits 0 into [0, 0]', () => {
      expect(splitAcc32(0)).toEqual([0, 0]);
    });
    it('splits 0x12345678 into [0x1234, 0x5678]', () => {
      expect(splitAcc32(0x1234_5678)).toEqual([0x1234, 0x5678]);
    });
    it('clamps negative input to 0', () => {
      expect(splitAcc32(-1)).toEqual([0, 0]);
    });
    it('clamps values above 0xFFFFFFFF to max-uint32 word pair', () => {
      const [hi, lo] = splitAcc32(0x1_0000_0000);
      expect(hi).toBe(0xffff);
      expect(lo).toBe(0xffff);
    });
  });
});
