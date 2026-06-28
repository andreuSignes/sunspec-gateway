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
 *
 * `KEY` namespaces the returned object under `config.app.*` instead of
 * the default random UUID, so consumers can read typed config via
 * `getAppConfig(config)` and `validateConfig` can find the same keys.
 */
const configuration = (): AppConfig => {
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

// Namespaces `configuration`'s output under `config.app.*` instead of a
// random UUID. Without this, `config.get('app.modbusPort')` returns
// `undefined` — see `node_modules/@nestjs/config/dist/utils/create-config-factory.util.js`.
(configuration as unknown as { KEY: string }).KEY = 'app';

export default configuration;

/**
 * Validate the loaded config against design.md §10 constraints. Called
 * by `ConfigModule.forRoot({ validate })` at boot — throws a descriptive
 * error before any service starts if a port is out of range or a
 * required field is empty.
 *
 * IMPORTANT: `@nestjs/config` calls `validate(config)` BEFORE the
 * `load:` factories are merged into `ConfigService`, so at this point
 * the raw config only has `.env` + `process.env` entries (UPPERCASE
 * keys). We re-apply defaults and read the same keys the loader would
 * have used. `assignVariablesToProcess` (called by `@nestjs/config`
 * after validate) also copies the validated values into `process.env`,
 * so the loader's `process.env['INVERTER_SN']` reads see them.
 */
export function validateConfig(config: Record<string, unknown>): AppConfig {
  // Re-apply defaults so a missing env var still validates against the
  // design.md §10 floor rather than failing the type check.
  const inverterBaseUrl =
    strFromEnv(config, 'INVERTER_BASE_URL') ??
    'http://192.168.1.50:8484';
  const inverterDeviceId = strFromEnv(config, 'INVERTER_DEVICE_ID') ?? '2';
  const inverterSn = strFromEnv(config, 'INVERTER_SN', { required: true }) as string;
  const inverterTimeoutMs =
    numFromEnv(config, 'INVERTER_TIMEOUT_MS') ?? 4000;
  const pollIntervalMs = numFromEnv(config, 'POLL_INTERVAL_MS') ?? 5000;
  const pollTimeoutMs = numFromEnv(config, 'POLL_TIMEOUT_MS') ?? 3000;
  const modbusHost = strFromEnv(config, 'MODBUS_HOST') ?? '0.0.0.0';
  const modbusPort = numFromEnv(config, 'MODBUS_PORT') ?? 5020;
  const modbusUnitId = numFromEnv(config, 'MODBUS_UNIT_ID') ?? 1;
  const staleAfterMs = numFromEnv(config, 'STALE_AFTER_MS') ?? 30000;
  const shutdownTimeoutMs = numFromEnv(config, 'SHUTDOWN_TIMEOUT_MS') ?? 5000;
  const httpPort = numFromEnv(config, 'HTTP_PORT') ?? 3000;

  validatePort('MODBUS_PORT', modbusPort);
  validatePort('MODBUS_UNIT_ID', modbusUnitId, 1, 247);
  validatePort('HTTP_PORT', httpPort);

  if (!/^https?:\/\//i.test(inverterBaseUrl)) {
    throw new Error(
      `INVERTER_BASE_URL must be an http(s) URL (got ${JSON.stringify(inverterBaseUrl)}).`,
    );
  }

  for (const [key, value] of [
    ['INVERTER_TIMEOUT_MS', inverterTimeoutMs],
    ['POLL_INTERVAL_MS', pollIntervalMs],
    ['POLL_TIMEOUT_MS', pollTimeoutMs],
    ['STALE_AFTER_MS', staleAfterMs],
    ['SHUTDOWN_TIMEOUT_MS', shutdownTimeoutMs],
  ] as const) {
    if (value <= 0) {
      throw new Error(`${key} must be a positive integer (got ${value}).`);
    }
  }

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
}

/** Read a UPPERCASE env-var key from `config` (the raw `@nestjs/config` record). */
function strFromEnv(
  config: Record<string, unknown>,
  key: string,
  opts: { required?: boolean } = {},
): string | undefined {
  const v = config[key];
  if (typeof v === 'string') {
    if (opts.required && v.length === 0) {
      throw new Error(`${key} is required — set it in .env.`);
    }
    return v;
  }
  if (opts.required) {
    throw new Error(`${key} is required (got ${JSON.stringify(v)}).`);
  }
  return undefined;
}

/** Read a UPPERCASE env-var key from `config` as integer. */
function numFromEnv(
  config: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = config[key];
  if (typeof v === 'number') return Number.isInteger(v) ? v : undefined;
  if (typeof v === 'string' && v.length > 0) {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) ? n : undefined;
  }
  return undefined;
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

/** Typed accessor — reads each key from `ConfigService` under `app.*`. */
export function getAppConfig(config: ConfigService): AppConfig {
  // `validateConfig` already guarantees each key is present and the right
  // shape at boot, so a non-null assertion is safe here.
  return {
    inverterBaseUrl: config.get<string>('app.inverterBaseUrl') as string,
    inverterDeviceId: config.get<string>('app.inverterDeviceId') as string,
    inverterSn: config.get<string>('app.inverterSn') as string,
    inverterTimeoutMs: config.get<number>('app.inverterTimeoutMs') as number,
    pollIntervalMs: config.get<number>('app.pollIntervalMs') as number,
    pollTimeoutMs: config.get<number>('app.pollTimeoutMs') as number,
    modbusHost: config.get<string>('app.modbusHost') as string,
    modbusPort: config.get<number>('app.modbusPort') as number,
    modbusUnitId: config.get<number>('app.modbusUnitId') as number,
    staleAfterMs: config.get<number>('app.staleAfterMs') as number,
    shutdownTimeoutMs: config.get<number>('app.shutdownTimeoutMs') as number,
    httpPort: config.get<number>('app.httpPort') as number,
  };
}