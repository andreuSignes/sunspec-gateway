/**
 * SunSpec operating state per sunspec/models model_101.json.
 *
 * Numeric values ARE the SunSpec `St` enum (1..8). Declared as a literal
 * union so they survive TypeScript compilation without erasure — both the
 * state bus and the Modbus server read these as numbers.
 */
export type InverterStatus = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Canonical, immutable snapshot of the inverter at one moment in time. */
export interface InverterState {
  /** AC output power, W, 0..15000. */
  readonly acPowerWatts: number;
  /** AC phase-A voltage, V, 0..300. */
  readonly acVoltageVolts: number;
  /** AC current, A, 0..100. */
  readonly acCurrentAmps: number;
  /** Grid frequency, Hz, 45..65. */
  readonly gridFrequencyHz: number;
  /** Lifetime energy, kWh, int32 range (BE). Preserved on stale. */
  readonly lifetimeEnergyKwh: number;
  /** SunSpec operating state (1..8). OFF (1) when stale. */
  readonly operatingState: InverterStatus;
  /** Vendor name, ≤ 32 chars, NUL-padded into Mn (M1). */
  readonly vendorName: string;
  /** Model name, ≤ 32 chars, NUL-padded into Md (M1). */
  readonly modelName: string;
  /** Serial number from config, ≤ 32 chars, NUL-padded into SN (M1). */
  readonly serialNumber: string;
  /** True when no fresh poll in > STALE_AFTER_MS. */
  readonly isStale: boolean;
  /** ms epoch, monotonically non-decreasing on success. 0 before first poll. */
  readonly lastUpdatedAt: number;
}

/**
 * Map our numeric operating state → SunSpec M101.St enum values.
 * The numeric values ARE the SunSpec enum — declared as a const so it
 * inlines and erases at compile time.
 */
export const M101_ST = {
  OFF: 1,
  SLEEPING: 2,
  STARTING: 3,
  MPPT: 4,
  THROTTLED: 5,
  SHUTTING_DOWN: 6,
  FAULT: 7,
  STANDBY: 8,
} as const;

/** DI token so other modules depend on the interface, not the concrete class. */
export const INVERTER_ADAPTER = Symbol('INVERTER_ADAPTER');

/**
 * Abstract class (not TS interface) so NestJS DI ergonomics work without
 * an explicit factory. Concrete adapter is bound via
 * `{ provide: INVERTER_ADAPTER, useExisting: SolplanetCgiAdapter }`.
 */
export abstract class InverterAdapter {
  /** Human-readable vendor name (used in SunSpec Model 1 `Mn`). */
  abstract readonly vendorName: string;

  /** Human-readable model name (used in SunSpec Model 1 `Md`). */
  abstract readonly modelName: string;

  /** Read a single snapshot. Never throws. */
  abstract read(): Promise<InverterState>;
}