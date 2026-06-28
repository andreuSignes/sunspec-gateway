import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { getAppConfig } from '../config/configuration';
import { HealthController } from '../health/health.controller';
import { InverterStateService } from '../state/inverter-state.service';
import { INVERTER_ADAPTER } from '../state/inverter-state.types';
import { SunSpecModbusServerService } from '../modbus/sunspec-modbus-server.service';

import { InverterPollingService } from './inverter-polling.service';
import { SolplanetCgiAdapter } from './inverters/solplanet-cgi.adapter';

/**
 * Root feature module — wires the three layers from design.md §1:
 *   adapter (transport)  → bus (domain)  → modbus server (wire).
 *
 * `InverterStateService` and `SunSpecModbusServerService` are exported
 * so a future test harness can inject a `FakeAdapter` directly without
 * going through `SolplanetCgiAdapter`.
 *
 * `HttpModule` is registered async with a factory so the axios timeout
 * reads from validated config — not a hard-coded constant.
 */
@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        timeout: getAppConfig(config).inverterTimeoutMs,
        maxRedirects: 0,
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController],
  providers: [
    InverterStateService,
    SunSpecModbusServerService,
    InverterPollingService,
    SolplanetCgiAdapter,
    {
      provide: INVERTER_ADAPTER,
      // `useExisting` keeps the concrete class in the DI tree so other
      // providers (the polling cron) can inject it directly if needed.
      useExisting: SolplanetCgiAdapter,
    },
  ],
  exports: [InverterStateService, SunSpecModbusServerService],
})
export class GatewayModule {}