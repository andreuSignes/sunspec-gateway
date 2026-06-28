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
 * Note on namespacing: an earlier revision set `KEY = 'app'` to wrap the
 * load result under `config.app.*`, but `@nestjs/config` v3 silently
 * discards the load-factory namespace when `validate` is also provided —
 * the validate return value REPLACES the merged config and is exposed
 * flat at the top level. So we read flat keys (`config.get('modbusPort')`)
 * everywhere and skip the namespace.
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

export default configuration;

/**
 * Validate the loaded config against design.md §10 constraints. Called
 * by `ConfigModule.forRoot({ validate })` at boot — throws a descriptive
 * error before any service starts if a port is out of range or a
 * required field is empty.
 *
 * IMPORTANT: `@nestjs/config` calls `validate(config)` BEFORE the
 * `load:` factories merge into `ConfigService`, so at this point the
 * raw config only has `.env` + `process.env` entries (UPPERCASE keys).
 * We re-apply defaults and read the same keys the loader uses. After
 * validate returns, `assignVariablesToProcess` copies the validated
 * values into `process.env` (lowercase keys), and the validate return
 * value is exposed flat at the top level of `ConfigService` (no `app.`
 * prefix — see the loader note above).
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

/**
 * Typed accessor — reads each validated key from `ConfigService`.
 *
 * `validateConfig` already guarantees each key is present and the right
 * shape at boot, so the `?? defaultValue` fallbacks are belt-and-braces
 * for the (impossible) case where someone bypasses the module wiring.
 */
export function getAppConfig(config: ConfigService): AppConfig {
  return {
    inverterBaseUrl:
      (config.get<string>('inverterBaseUrl') as string) ??
      'http://192.168.1.50:8484',
    inverterDeviceId:
      (config.get<string>('inverterDeviceId') as string) ?? '2',
    inverterSn: (config.get<string>('inverterSn') as string) ?? '',
    inverterTimeoutMs:
      (config.get<number>('inverterTimeoutMs') as number) ?? 4000,
    pollIntervalMs:
      (config.get<number>('pollIntervalMs') as number) ?? 5000,
    pollTimeoutMs:
      (config.get<number>('pollTimeoutMs') as number) ?? 3000,
    modbusHost: (config.get<string>('modbusHost') as string) ?? '0.0.0.0',
    modbusPort: (config.get<number>('modbusPort') as number) ?? 5020,
    modbusUnitId: (config.get<number>('modbusUnitId') as number) ?? 1,
    staleAfterMs: (config.get<number>('staleAfterMs') as number) ?? 30000,
    shutdownTimeoutMs:
      (config.get<number>('shutdownTimeoutMs') as number) ?? 5000,
    httpPort: (config.get<number>('httpPort') as number) ?? 3000,
  };
}