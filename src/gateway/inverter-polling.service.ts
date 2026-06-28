/**
 * 5 s polling cron.
 *
 * The cron is the only caller of `adapter.read()`, `bus.publish()`, and
 * `modbus.refreshFromBus()`. Three sequential awaits — no concurrency —
 * so the double-buffer swap always reflects a fully-written state.
 *
 * Failure handling:
 *   - `adapter.read()` is contractually required NOT to throw (see
 *     `InverterAdapter` JSDoc and `SolplanetCgiAdapter` implementation).
 *   - The try/catch here is belt-and-braces — if a future adapter
 *     regresses on that contract, the cron logs a WARN instead of
 *     rethrowing into the NestJS scheduler.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import {
  INVERTER_ADAPTER,
  InverterAdapter,
} from '../state/inverter-state.types';
import { InverterStateService } from '../state/inverter-state.service';
import { SunSpecModbusServerService } from '../modbus/sunspec-modbus-server.service';

@Injectable()
export class InverterPollingService {
  private readonly logger = new Logger(InverterPollingService.name);

  constructor(
    @Inject(INVERTER_ADAPTER) private readonly adapter: InverterAdapter,
    private readonly bus: InverterStateService,
    private readonly modbus: SunSpecModbusServerService,
  ) {}

  /**
   * Sched tick — every 5 s, per design.md §8. Three sequential steps:
   *   1. adapter.read()        — HTTP CGI round-trip
   *   2. bus.publish(state)    — stamp + remember last-good
   *   3. modbus.refreshFromBus — write the inactive buffer + atomic swap
   *
   * The cron decorator is fixed at 5 s in v1. `POLL_INTERVAL_MS` is
   * kept as a config knob for tests and for a future PR that swaps to
   * a dynamic interval.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleTick(): Promise<void> {
    try {
      const state = await this.adapter.read();
      this.bus.publish(state);
      this.modbus.refreshFromBus(state);
    } catch (err) {
      this.logger.warn(
        `poll tick failed: ${(err as Error).message ?? String(err)}`,
      );
    }
  }
}