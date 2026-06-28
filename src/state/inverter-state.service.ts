import { Injectable, Logger } from '@nestjs/common';
import { InverterState } from '../domain/inverter-state';

@Injectable()
export class InverterStateService {
  private readonly logger = new Logger(InverterStateService.name);
  private current: InverterState | null = null;
  private lastGood: InverterState | null = null;

  /** Threshold beyond which the current state is treated as stale. */
  static readonly STALE_AFTER_MS = 30_000;

  setState(next: InverterState): void {
    this.current = next;
    if (!next.isStale) this.lastGood = next;
  }

  /**
   * Returns the latest state, or an offline-promoted snapshot when the
   * last fresh publish is older than STALE_AFTER_MS. Identity fields
   * (serialNumber, totalEnergyKwh) and lastGood data are preserved.
   */
  getState(): InverterState {
    if (!this.current) return this.emptyState();

    if (
      Date.now() - this.current.lastUpdated.getTime() >
      InverterStateService.STALE_AFTER_MS
    ) {
      const stale = this.lastGood ?? this.current;
      this.logger.warn('No fresh data — marking state offline');
      return {
        ...stale,
        acPowerWatts: 0,
        acCurrent: 0,
        status: 'offline',
        isStale: true,
        lastUpdated: this.current.lastUpdated,
      };
    }

    return this.current;
  }

  getLastGood(): InverterState | null {
    return this.lastGood;
  }

  private emptyState(): InverterState {
    return {
      serialNumber: 'UNKNOWN',
      acPowerWatts: 0,
      acVoltage: 0,
      acCurrent: 0,
      acFrequency: 0,
      totalEnergyKwh: 0,
      status: 'offline',
      lastUpdated: new Date(),
      isStale: true,
    };
  }
}
