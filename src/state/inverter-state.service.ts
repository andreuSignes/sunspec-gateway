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

    // Promote to offline if upstream hasn't reported in too long.
    if (
      this.lastGood &&
      Date.now() - this.lastGood.lastUpdated.getTime() >
        InverterStateService.STALE_AFTER_MS
    ) {
      this.logger.warn('No fresh data — marking state offline');
      this.current = {
        ...this.lastGood,
        acPowerWatts: 0,
        acCurrent: 0,
        status: 'offline',
        isStale: true,
        lastUpdated: new Date(),
      };
    }
  }

  getState(): InverterState {
    if (!this.current) return this.emptyState();
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
