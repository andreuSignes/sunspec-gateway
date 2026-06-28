import { InverterState } from '../../domain/inverter-state';

/** DI token for the active inverter adapter implementation. */
export const INVERTER_ADAPTER = Symbol('INVERTER_ADAPTER');

/**
 * Contract every inverter adapter must satisfy.
 *
 * Adapters own: transport (HTTP, Modbus, serial), vendor protocol parsing,
 * and the canonical mapping from vendor fields to InverterState.
 *
 * Adapters MUST NOT throw on transient errors. Return a marked-stale state
 * on timeout, parse error, or transport failure — the state bus will surface
 * `isStale: true` to the Modbus layer, which writes `St=OFF`.
 */
export abstract class InverterAdapter {
  /** Human-readable vendor name (used in SunSpec Model 1 `Mn`). */
  abstract readonly vendorName: string;

  /** Human-readable model name (used in SunSpec Model 1 `Md`). */
  abstract readonly modelName: string;

  /** Fetch a single snapshot. Never throws. */
  abstract fetchState(): Promise<InverterState>;
}
