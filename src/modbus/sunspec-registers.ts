/**
 * SunSpec Model 1 (Common) and Model 101 (Single-Phase Inverter) register map.
 *
 * All offsets below are ABSOLUTE buffer offsets (registers), where the holding
 * register block starts at offset 0 (register 40000 in Modbus addressing).
 *
 * Layout (verified against sunspec/models model_1.json + model_101.json at
 * https://github.com/sunspec/models, and against the spec scenario in
 * openspec/changes/sunspec-modbus-gateway/specs/sunspec-modbus-server.md):
 *
 *   offset  0..  1  SunS magic 0x5375 0x6E53 ("SunS")
 *   offset  2..  3  Model 1 header  (ID=1,  L=68)
 *   offset  4.. 19  M1.Mn           (16 regs = 32 chars, NUL-padded)
 *   offset 20.. 35  M1.Md           (16 regs = 32 chars)
 *   offset 36.. 43  M1.Opt          ( 8 regs = 16 chars, zeroed)
 *   offset 44.. 51  M1.Vr           ( 8 regs = 16 chars, zeroed)
 *   offset 52.. 67  M1.SN           (16 regs = 32 chars)
 *   offset 68      M1.DA           (Modbus unit ID)
 *   offset 69      M1.Pad          (canonical even-alignment pad)
 *   offset 70.. 71  Model 101 header (ID=101, L=52)
 *   offset 72..121  M101 body (50 regs)
 *   offset 122      End-of-models sentinel 0xFFFF
 *
 * The full 124-register buffer (offsets 0..123) is allocated for breathing
 * room; offset 123 is reserved as zeroed padding.
 *
 * Endianness note (explicit): every register is big-endian uint16 on the
 * wire. `modbus-serial` v8 `ServerTCP` calls our handlers with `addr` =
 * buffer offset, and reads each register as a BE uint16. Multi-register
 * values (acc32, string) are split into per-register BE uint16s.
 */
export const M1 = {
  ID: 2,
  L: 3,
  MN_START: 4,
  MN_END: 19, // 16 regs = 32 chars
  MD_START: 20,
  MD_END: 35, // 16 regs = 32 chars
  OPT_START: 36,
  OPT_END: 43, // 8 regs = 16 chars
  VR_START: 44,
  VR_END: 51, // 8 regs = 16 chars
  SN_START: 52,
  SN_END: 67, // 16 regs = 32 chars
  DA: 68,
  PAD: 69,
  LENGTH: 68,
} as const;

/**
 * SunSpec Model 101 (Single-Phase Inverter) — L=52. Offsets are absolute.
 * Counts: 45 points, but Evt1/Evt2/EvtVnd1-4 are bitfield32 (size=2), so
 * total registers = 2 (header) + 41 (single) + 9 (six size-2 entries) = 52.
 *
 * Only the M101 fields projected onto `InverterState` are listed here.
 * Unused fields (AphB, AphC, VA, VAr, PF, DCA, DCV, Tmp*, StVnd, Evt*) keep
 * their canonical offset so a future PR can extend the projection without
 * reshuffling the layout.
 */
export const M101 = {
  ID: 70,
  L: 71,
  A: 72, // AC current (A), uint16
  APHA: 73, // Phase A current (A), uint16
  APHB: 74,
  APHC: 75,
  A_SF: 76, // sunssf, shared by A/AphA/AphB/AphC
  PPVPHAB: 77, // DC voltage phase AB
  PPVPHBC: 78,
  PPVPHCA: 79,
  PHVPHA: 80, // AC voltage phase A (V), uint16
  PHVPHB: 81,
  PHVPHC: 82,
  V_SF: 83, // sunssf, shared by PhVph* and PPVph*
  W: 84, // AC power (W), int16
  W_SF: 85,
  HZ: 86, // Grid frequency (Hz), uint16
  HZ_SF: 87,
  WH_HI: 94, // Lifetime energy acc32, BE: hi word at +24, lo word at +25
  WH_LO: 95,
  WH_SF: 96,
  DCA: 97,
  DCA_SF: 98,
  DCV: 99,
  DCV_SF: 100,
  DCW: 101, // DC power (W), int16
  DCW_SF: 102,
  TMPCAB: 103, // Cabinet temperature (C), int16
  TMPSNK: 104,
  TMPTRNS: 105,
  TMPOT: 106,
  TMP_SF: 107,
  ST: 108, // Operating state, enum16 — numeric values are 1..8
  EVT1: 110, // bitfield32 (size=2: offsets 110,111)
  EVT2: 112, // bitfield32 (size=2)
  EVT_VND1: 114,
  EVT_VND2: 116,
  EVT_VND3: 118,
  EVT_VND4: 120,
  LENGTH: 52,
} as const;

/** Layout constants for the double-buffer. */
export const SUNS_MAGIC_HI = 0x5375; // 'Su'
export const SUNS_MAGIC_LO = 0x6e53; // 'nS'
export const EOM_SENTINEL = 0xffff;
/** Total holding-register block size — offsets 0..123 inclusive (124 regs). */
export const HOLDING_REGISTER_COUNT = 124;

/**
 * Write a 16-bit unsigned value at `offset` (in registers). Writes BE uint16
 * (high byte first) at byte position `offset * 2`.
 */
export function writeUint16(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16BE(value & 0xffff, offset * 2);
}

/**
 * Write a signed 32-bit value across two consecutive registers, big-endian:
 * `buf[offset*2] = hi`, `buf[offset*2 + 2] = lo`. SunSpec doesn't expose a
 * true int32 in M101 (only `acc32`, which is unsigned), but the helper is
 * here for symmetry and possible future use.
 */
export function writeInt32BE(buf: Buffer, offset: number, value: number): void {
  buf.writeInt32BE(value | 0, offset * 2);
}

/**
 * Write an ASCII string into `regCount` registers (2 chars per register),
 * big-endian per register, NUL-padded to exactly `regCount * 2` bytes.
 * `modbus-serial` reads each register as a BE uint16, so the high byte
 * carries the first ASCII char of the pair.
 */
export function writeSunSpecString(
  buf: Buffer,
  offset: number,
  value: string,
  regCount: number,
): void {
  const bytes = Buffer.alloc(regCount * 2, 0); // NUL-padded
  bytes.write(value.slice(0, regCount * 2), 0, regCount * 2, 'ascii');
  for (let i = 0; i < regCount; i++) {
    buf.writeUInt16BE(bytes.readUInt16BE(i * 2), (offset + i) * 2);
  }
}