import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { getAppConfig } from './config/configuration';
import { AppModule } from './app.module';

/**
 * Boot the gateway.
 *
 * Steps:
 *   1. `NestFactory.create(AppModule)` — wires DI, runs `validateConfig`.
 *   2. `enableShutdownHooks()` — SIGTERM/SIGINT trigger
 *      `OnApplicationShutdown`, giving the Modbus server a 5 s grace
 *      period to close its TCP socket cleanly (per design.md §10).
 *   3. `app.listen(httpPort)` — bind the HTTP server for `/healthz`.
 *
 * `bufferLogs: false` so the Nest bootstrap log lines land on stdout
 * without going through the internal buffer first — simpler to read in
 * `journalctl` / Docker logs.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();

  // Read HTTP_PORT from the validated config — guarantees it was
  // already range-checked by `validateConfig`.
  const config = app.get(ConfigService);
  const httpPort = getAppConfig(config).httpPort;

  await app.listen(httpPort);
  new Logger('Bootstrap').log(`HTTP listening on :${httpPort}`);
}

void bootstrap();