import { ConfigService } from '@nestjs/config';

/**
 * Typed runtime configuration, loaded from `process.env` via `@nestjs/config`.
 *
 * Defaults come from design.md §10. Every port-valued key is validated
 * against `[1, 65535]` at boot — out-of-range → the process exits with a
 * descriptive log line. This avoids discovering the misconfiguration five
 * minutes later when the Modbus server fails to bind.
 *
 * @see openspec/changes/sunspec-modbus-gateway/design.md §10
 */
export interface AppConfig {
  /** CGI base URL of the inverter (e.g. `http://192.168.1.50:8484`). */
  inverterBaseUrl: string;
  /** Solplanet device id (the `device` query param). */
  inverterDeviceId: string;
  /** Inverter serial number (required for the `sn` query param). */
  inverterSn: string;
  /** Axios timeout for the inverter CGI call. */
  inverterTimeoutMs: number;
  /** Sched tick interval (decorator-fixed at 5 s in v1, exposed for testing). */
  pollIntervalMs: number;
  /** Adapter-internal abort budget — independent of axios timeout. */
  pollTimeoutMs: number;
  /** Bind address for the Modbus TCP server. Private interface in prod. */
  modbusHost: string;
  /** Non-privileged port for the Modbus TCP server. */
  modbusPort: number;
  /** Modbus unit (slave) id reported in M1.DA. */
  modbusUnitId: number;
  /** Stale-data threshold for `InverterStateService.snapshot()`. */
  staleAfterMs: number;
  /** Graceful-close budget for `OnApplicationShutdown`. */
  shutdownTimeoutMs: number;
  /** HTTP port for the `/healthz` endpoint. */
  httpPort: number;
}

/**
 * `@nestjs/config` loader. Reads from `process.env` and applies defaults
 * from design.md §10. Returning the object — not a Promise — is the
 * supported shape for `load: [...]` in `ConfigModule.forRoot()`.
 */
export default (): AppConfig => {
  const inverterBaseUrl = process.env['INVERTER_BASE_URL'] ?? 'http://192.168.1.50:8484';
  const inverterDeviceId = process.env['INVERTER_DEVICE_ID'] ?? '2';
  const inverterSn = process.env['INVERTER_SN'] ?? '';
  const inverterTimeoutMs = toInt(process.env['INVERTER_TIMEOUT_MS'], 4000);
  const pollIntervalMs = toInt(process.env['POLL_INTERVAL_MS'], 5000);
  const pollTimeoutMs = toInt(process.env['POLL_TIMEOUT_MS'], 3000);
  const modbusHost = process.env['MODBUS_HOST'] ?? '0.0.0.0';
  const modbusPort = toInt(process.env['MODBUS_PORT'], 5020);
  const modbusUnitId = toInt(process.env['MODBUS_UNIT_ID'], 1);
  const staleAfterMs = toInt(process.env['STALE_AFTER_MS'], 30000);
  const shutdownTimeoutMs = toInt(process.env['SHUTDOWN_TIMEOUT_MS'], 5000);
  const httpPort = toInt(process.env['HTTP_PORT'], 3000);

  return {
    inverterBaseUrl,
    inverterDeviceId,
    inverterSn,
    inverterTimeoutMs,
    pollIntervalMs,
    pollTimeoutMs,
    modbusHost,
    modbusPort,
    modbusUnitId,
    staleAfterMs,
    shutdownTimeoutMs,
    httpPort,
  };
};

/**
 * Validate the loaded config against design.md §10 constraints. Called
 * by `ConfigModule.forRoot({ validate })` at boot — throws a descriptive
 * error before any service starts if a port is out of range or a
 * required field is empty.
 */
export function validateConfig(config: Record<string, unknown>): AppConfig {
  const app = config as unknown as AppConfig;

  validatePort('MODBUS_PORT', app.modbusPort);
  validatePort('MODBUS_UNIT_ID', app.modbusUnitId, 1, 247); // Modbus spec: 1..247
  validatePort('HTTP_PORT', app.httpPort);

  if (typeof app.inverterSn === 'string' && app.inverterSn.length === 0) {
    throw new Error(
      'INVERTER_SN is required — set it in .env to the inverter serial number (≤ 32 chars).',
    );
  }

  if (
    typeof app.inverterBaseUrl !== 'string' ||
    !/^https?:\/\//i.test(app.inverterBaseUrl)
  ) {
    throw new Error(
      `INVERTER_BASE_URL must be an http(s) URL (got ${JSON.stringify(app.inverterBaseUrl)}).`,
    );
  }

  if (!Number.isInteger(app.inverterTimeoutMs) || app.inverterTimeoutMs <= 0) {
    throw new Error(
      `INVERTER_TIMEOUT_MS must be a positive integer (got ${app.inverterTimeoutMs}).`,
    );
  }
  if (!Number.isInteger(app.pollIntervalMs) || app.pollIntervalMs <= 0) {
    throw new Error(
      `POLL_INTERVAL_MS must be a positive integer (got ${app.pollIntervalMs}).`,
    );
  }
  if (!Number.isInteger(app.pollTimeoutMs) || app.pollTimeoutMs <= 0) {
    throw new Error(
      `POLL_TIMEOUT_MS must be a positive integer (got ${app.pollTimeoutMs}).`,
    );
  }
  if (!Number.isInteger(app.staleAfterMs) || app.staleAfterMs <= 0) {
    throw new Error(
      `STALE_AFTER_MS must be a positive integer (got ${app.staleAfterMs}).`,
    );
  }
  if (!Number.isInteger(app.shutdownTimeoutMs) || app.shutdownTimeoutMs <= 0) {
    throw new Error(
      `SHUTDOWN_TIMEOUT_MS must be a positive integer (got ${app.shutdownTimeoutMs}).`,
    );
  }

  return app;
}

/**
 * Port validator — throws with a descriptive message if `value` falls
 * outside `[min, max]`. Default range is the full TCP/UDP port range
 * (1..65535); MODBUS_UNIT_ID uses the tighter Modbus spec range
 * (1..247) via the overrides.
 */
function validatePort(
  key: string,
  value: number,
  min: number = 1,
  max: number = 65535,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${key} must be an integer in [${min}, ${max}] (got ${JSON.stringify(value)}).`,
    );
  }
}

/** Parse an env var as int, falling back to `fallback` if missing/NaN. */
function toInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Typed accessor — returns `config.get<AppConfig>(...)` with the right key shape. */
export function getAppConfig(config: ConfigService): AppConfig {
  // ConfigService.get<T> with a non-literal key returns `T | undefined`;
  // `validateConfig` guarantees the keys exist at boot, so a non-null
  // assertion is safe here.
  return config.get('appConfig') as unknown as AppConfig;
}