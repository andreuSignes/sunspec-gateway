/**
 * Solplanet ASW H-S2 series HTTP CGI adapter.
 *
 * Source of truth for the CGI response shape: docs/QG0028_ASW6000-10000-S_EN_540-30170-03_V04_0723-2.pdf
 * (Solplanet quick-installation / Modbus integration guide). The field
 * names below come from the inverter's `/getdevdata.cgi` JSON response.
 *
 * Contract — this adapter NEVER throws:
 *   - HTTP errors (timeout, non-2xx, connection refused) → offline state
 *   - JSON parse errors → offline state
 *   - Non-numeric / missing fields → coerced to safe defaults (0 / OFF)
 *
 * The polling service wraps `read()` in try/catch as belt-and-braces, but
 * the adapter's contract is "always resolve, never reject" so the cron
 * can stay simple.
 *
 * ## Response shape (CGI JSON)
 *
 * The inverter returns a flat object with keys like:
 * ```json
 * {
 *   "STATE":  "online",         // string: online | sleeping | starting | fault | ...
 *   "Pac":    4523,             // W
 *   "Vac":    230.5,            // V
 *   "Iac":    19.6,             // A
 *   "Fac":    50.02,            // Hz
 *   "WH":     12345.6,          // kWh (lifetime) — may also appear as "E-Total"
 *   "Ppv":    4601,             // W  (optional, DC input)
 *   "Vpv":    380.2,            // V  (optional)
 *   "Ipv":    12.1,             // A  (optional)
 *   "T":      42.3              // °C (optional, cabinet temp)
 * }
 * ```
 *
 * The field-name drift across firmware versions is the kind of thing
 * that bites silently — a renamed key in a firmware push turns into an
 * `OFFLINE` reading with no obvious cause. If a new key shows up on a
 * real device, prefer adding it here over patching the polling cron.
 */
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { catchError, firstValueFrom, of, timeout } from 'rxjs';

import {
  InverterAdapter,
  InverterState,
  M101_ST,
} from '../../state/inverter-state.types';
import { getAppConfig } from '../../config/configuration';

/**
 * Raw response payload from `getdevdata.cgi`. Every field is optional
 * because Solplanet firmware versions differ in what they emit — a
 * missing key MUST NOT break the adapter.
 */
interface SolplanetPayload {
  // AC side
  STATE?: string | number;
  Pac?: number | string;
  Vac?: number | string;
  Iac?: number | string;
  Fac?: number | string;
  // Lifetime energy — firmware alternates between `WH` and `E-Total`.
  WH?: number | string;
  'E-Total'?: number | string;
  // DC side (optional)
  Ppv?: number | string;
  Vpv?: number | string;
  Ipv?: number | string;
  // Cabinet temperature (optional)
  T?: number | string;
  // Identity — typically injected from config, not the CGI payload.
  SN?: string;
  // Anything else: pass-through, ignored.
  [key: string]: unknown;
}

@Injectable()
export class SolplanetCgiAdapter extends InverterAdapter {
  public readonly vendorName = 'Solplanet';
  public readonly modelName = 'ASW H-S2';

  private readonly logger = new Logger(SolplanetCgiAdapter.name);
  private readonly baseUrl: string;
  private readonly deviceId: string;
  private readonly serial: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    super();
    const app = getAppConfig(config);
    this.baseUrl = app.inverterBaseUrl.replace(/\/+$/, ''); // strip trailing slashes
    this.deviceId = app.inverterDeviceId;
    this.serial = app.inverterSn;
    this.timeoutMs = app.inverterTimeoutMs;
  }

  /**
   * Read a single snapshot from the inverter. NEVER throws.
   *
   * Failure modes:
   *   - axios timeout (uses `INVERTER_TIMEOUT_MS` as a wall-clock budget)
   *   - non-2xx HTTP status
   *   - non-JSON body
   *   - non-numeric value where a number is expected
   *
   * Any of the above → returns an offline `InverterState` with
   * `isStale: true`, `operatingState: OFF`, zeroed production values,
   * and identity preserved from config.
   */
  override async read(): Promise<InverterState> {
    const url = `${this.baseUrl}/getdevdata.cgi?device=${encodeURIComponent(this.deviceId)}&sn=${encodeURIComponent(this.serial)}`;

    try {
      const response = await firstValueFrom(
        this.http.get<SolplanetPayload>(url).pipe(
          // Wall-clock guard — independent of the axios-level timeout
          // so a stalled TCP socket can't wedge the cron.
          timeout({ each: this.timeoutMs }),
          catchError((err: unknown) => {
            this.logAdapterError('http', err);
            return of(null);
          }),
        ),
      );

      if (!response || response.status < 200 || response.status >= 300) {
        this.logger.warn(
          `inverter CGI returned status ${response?.status ?? 'no-response'} — going offline`,
        );
        return this.offlineState();
      }

      const payload = this.parsePayload(response.data);
      if (!payload) {
        this.logger.warn('inverter CGI returned non-JSON or empty body — going offline');
        return this.offlineState();
      }

      return this.mapToState(payload);
    } catch (err) {
      // `firstValueFrom` only throws on `EMPTY` completion, which we
      // never emit — but the catch stays as defensive belt-and-braces.
      this.logAdapterError('read', err);
      return this.offlineState();
    }
  }

  /**
   * Parse the response body as JSON. The CGI endpoint always returns
   * `Content-Type: application/json`, but be lenient — some firmwares
   * emit text/plain with a JSON body.
   */
  private parsePayload(raw: unknown): SolplanetPayload | null {
    if (raw && typeof raw === 'object') {
      return raw as SolplanetPayload;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null
          ? (parsed as SolplanetPayload)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Project the Solplanet payload into our canonical `InverterState`.
   * Every numeric field is coerced via `toFiniteNumber` so a stray
   * string or NaN in the payload becomes 0 instead of poisoning the
   * scale-factor math downstream.
   */
  private mapToState(payload: SolplanetPayload): InverterState {
    const lifetimeEnergyKwh =
      toFiniteNumber(payload['E-Total']) ?? toFiniteNumber(payload.WH) ?? 0;

    return {
      acPowerWatts: toFiniteNumber(payload.Pac) ?? 0,
      acVoltageVolts: toFiniteNumber(payload.Vac) ?? 0,
      acCurrentAmps: toFiniteNumber(payload.Iac) ?? 0,
      gridFrequencyHz: toFiniteNumber(payload.Fac) ?? 0,
      lifetimeEnergyKwh,
      operatingState: mapOperatingState(payload.STATE),
      vendorName: this.vendorName,
      modelName: this.modelName,
      serialNumber: this.serial,
      isStale: false,
      lastUpdatedAt: 0, // bus owns the real timestamp
    };
  }

  /**
   * Offline snapshot — all production values zeroed, identity preserved
   * from config, `isStale: true`, `operatingState: OFF`. The polling
   * service publishes this verbatim; the state bus preserves the
   * previous `lastUpdatedAt` so the 30 s stale threshold trips
   * correctly.
   */
  private offlineState(): InverterState {
    return {
      acPowerWatts: 0,
      acVoltageVolts: 0,
      acCurrentAmps: 0,
      gridFrequencyHz: 0,
      lifetimeEnergyKwh: 0,
      operatingState: M101_ST.OFF,
      vendorName: this.vendorName,
      modelName: this.modelName,
      serialNumber: this.serial,
      isStale: true,
      lastUpdatedAt: 0,
    };
  }

  /**
   * Surface HTTP errors at WARN level — debug would be too quiet in a
   * 24/7 deployment, ERROR would drown out real issues. The full axios
   * error is logged so an operator can diagnose a misconfigured URL.
   */
  private logAdapterError(stage: string, err: unknown): void {
    if (err instanceof AxiosError) {
      this.logger.warn(
        `inverter CGI ${stage} failed: ${err.code ?? err.message} (${err.config?.url ?? '?'})`,
      );
    } else if (err instanceof Error) {
      this.logger.warn(`inverter CGI ${stage} failed: ${err.message}`);
    } else {
      this.logger.warn(`inverter CGI ${stage} failed: ${String(err)}`);
    }
  }
}

/**
 * Coerce any value into a finite number. Returns `null` for NaN /
 * Infinity / non-numeric strings so callers can apply their own
 * fallback. Pure function — exported for tests.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Map Solplanet's stringy STATE field onto the SunSpec M101.St enum.
 * Returns `OFF` for anything unrecognized — the bus treats `OFF` as
 * "no fresh data" downstream.
 *
 * The inverter emits a string here; older firmware reportedly emits
 * a numeric code — accept both.
 */
export function mapOperatingState(raw: unknown): InverterState['operatingState'] {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw >= 1 && raw <= 8) return raw as InverterState['operatingState'];
    return M101_ST.OFF;
  }

  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();

  switch (normalized) {
    case 'online':
    case 'mppt':
    case 'running':
    case 'grid-connected':
    case 'normal':
      return M101_ST.MPPT;
    case 'sleeping':
    case 'standby':
    case 'idle':
      return M101_ST.SLEEPING;
    case 'starting':
    case 'startup':
    case 'init':
      return M101_ST.STARTING;
    case 'fault':
    case 'error':
    case 'alarm':
      return M101_ST.FAULT;
    case 'off':
    case 'shutdown':
    case 'stopped':
    case '':
      return M101_ST.OFF;
    default:
      return M101_ST.OFF;
  }
}