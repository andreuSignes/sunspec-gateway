import { Injectable, Logger } from '@nestjs/common';
import { InverterState, M101_ST } from './inverter-state.types';

@Injectable()
export class InverterStateService {
  private readonly logger = new Logger(InverterStateService.name);
  private current: InverterState | null = null;
  private lastGood: InverterState | null = null;

  /** Threshold beyond which the current state is treated as stale. */
  static readonly STALE_AFTER_MS = 30_000;

  /**
   * Publish a new state from the adapter.
   *
   * The bus owns `lastUpdatedAt`: a fresh publish stamps `Date.now()`;
   * an `isStale` publish preserves the previous `lastUpdatedAt` so the
   * time-based stale threshold trips correctly. The adapter's
   * `lastUpdatedAt` value is ignored — the adapter may pass any sentinel
   * (typically `0`) and the bus will overwrite it.
   *
   * `lastGood` is only updated on fresh (non-stale) publishes so a
   * failed poll doesn't wipe the last-known-good snapshot.
   */
  publish(state: InverterState): void {
    if (state.isStale) {
      const prevTimestamp = this.current?.lastUpdatedAt ?? 0;
      this.current = { ...state, lastUpdatedAt: prevTimestamp };
    } else {
      const withTimestamp: InverterState = { ...state, lastUpdatedAt: Date.now() };
      this.current = withTimestamp;
      this.lastGood = withTimestamp;
    }
  }

  /**
   * Returns the latest state. When the last fresh publish is older than
   * STALE_AFTER_MS, the snapshot has all production fields zeroed,
   * `operatingState = OFF`, `isStale = true`, and `lastUpdatedAt`
   * stamped to now. Identity fields (`vendorName`, `modelName`,
   * `serialNumber`) and `lifetimeEnergyKwh` are preserved from the
   * last good publish.
   */
  snapshot(): InverterState {
    if (!this.current) return this.emptyState();

    const ageMs = Date.now() - this.current.lastUpdatedAt;
    if (ageMs < InverterStateService.STALE_AFTER_MS) {
      return this.current;
    }

    const base = this.lastGood ?? this.current;
    this.logger.warn('No fresh data — marking state stale');
    return {
      ...base,
      acPowerWatts: 0,
      acVoltageVolts: 0,
      acCurrentAmps: 0,
      gridFrequencyHz: 0,
      operatingState: M101_ST.OFF,
      isStale: true,
      lastUpdatedAt: Date.now(),
    };
  }

  getLastGood(): InverterState | null {
    return this.lastGood;
  }

  private emptyState(): InverterState {
    return {
      acPowerWatts: 0,
      acVoltageVolts: 0,
      acCurrentAmps: 0,
      gridFrequencyHz: 0,
      lifetimeEnergyKwh: 0,
      operatingState: M101_ST.OFF,
      vendorName: 'UNKNOWN',
      modelName: 'UNKNOWN',
      serialNumber: 'UNKNOWN',
      isStale: true,
      lastUpdatedAt: 0,
    };
  }
}