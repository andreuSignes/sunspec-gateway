import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration, { validateConfig } from './config/configuration';
import { GatewayModule } from './gateway/gateway.module';

/**
 * Root module — `ConfigModule` is global so the polling cron, the Modbus
 * server, and the adapter can each `inject(ConfigService)` without
 * re-importing the module at every feature boundary.
 *
 * Validation runs at boot (`validate: validateConfig`) so an
 * out-of-range port or a missing `INVERTER_SN` crashes the process
 * immediately, not 30 seconds later when the Modbus server fails to bind.
 *
 * No global guards / pipes / interceptors — the gateway is internal-only
 * (Modbus TCP on a private interface, `/healthz` is unauthenticated on
 * purpose for Docker / k8s liveness probes).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateConfig,
    }),
    GatewayModule,
  ],
})
export class AppModule {}