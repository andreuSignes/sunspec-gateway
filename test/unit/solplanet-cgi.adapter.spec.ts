/**
 * Adapter robustness tests.
 *
 * Exercises every documented failure path of `SolplanetCgiAdapter.read()`:
 *   - HTTP 4xx / 5xx (502, 404)
 *   - Network timeout (axios timeout fires firstValueFrom with an error)
 *   - Connection refused (ECONNREFUSED — adapter still resolves offline)
 *   - Malformed JSON body
 *   - Non-numeric / null / missing fields
 *
 * Each scenario asserts:
 *   1. `read()` resolves (never rejects).
 *   2. The returned state is `isStale=true` and `operatingState=OFF`.
 *   3. Production numeric fields are coerced to safe defaults.
 *
 * Covers the spec scenarios in `openspec/changes/sunspec-modbus-gateway/specs/`
 *   - `inverter-adapter-interface.md` — "Adapter implementations never throw on transient errors"
 *   - `solplanet-cgi-adapter.md` — "Adapter returns offline state on HTTP 4xx/5xx without throwing",
 *     "Adapter returns offline state on JSON parse error",
 *     "Adapter coerces non-numeric inverter responses to safe defaults".
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { Observable, from as rxFrom } from 'rxjs';
import nock from 'nock';

import {
  SolplanetCgiAdapter,
  mapOperatingState,
  toFiniteNumber,
} from '../../src/gateway/inverters/solplanet-cgi.adapter';
import { M101_ST } from '../../src/state/inverter-state.types';

const BASE_URL = 'http://192.168.1.99:8484';
const DEVICE = '2';
const SN = 'TEST-SN-ABC';

/**
 * Build a real `HttpService` that uses axios directly. `nock` intercepts
 * the underlying socket so axios never hits the network — every reply
 * recorded via `nock(...).reply(...)` lands in `response.data` exactly
 * as a real CGI server would deliver it.
 *
 * `HttpService.axiosRef` returns the configured axios instance; the
 * adapter uses `this.http.get()` (the request-config style) which is
 * exposed as a method on `HttpService`. We wrap `axios.request` as a
 * function that returns the same shape `HttpService.get()` returns.
 */
function makeAdapter(): Promise<SolplanetCgiAdapter> {
  return Test.createTestingModule({
    providers: [
      {
        provide: ConfigService,
        useValue: {
          get: (key: string): unknown => {
            const map: Record<string, unknown> = {
              inverterBaseUrl: BASE_URL,
              inverterDeviceId: DEVICE,
              inverterSn: SN,
              inverterTimeoutMs: 1000,
              pollIntervalMs: 5000,
              pollTimeoutMs: 3000,
              modbusHost: '127.0.0.1',
              modbusPort: 5020,
              modbusUnitId: 1,
              staleAfterMs: 30000,
              shutdownTimeoutMs: 5000,
              httpPort: 3000,
            };
            return map[key];
          },
        },
      },
      {
        provide: HttpService,
        useFactory: () => {
          const instance = axios.create({ timeout: 1000 });
          // Match `@nestjs/axios` HttpService surface: `get()` returns an
          // observable-style object that RxJS can `.pipe()`.
          const fakeHttp = {
            axiosRef: instance,
            get: <T>(url: string): Observable<{ status: number; data: T }> =>
              rxFrom(
                instance.get<T, { status: number; data: T }>(url).then(
                  (r) => ({ status: r.status, data: r.data }),
                ),
              ),
          };
          return fakeHttp as unknown as HttpService;
        },
      },
      SolplanetCgiAdapter,
    ],
  })
    .compile()
    .then((m) => m.get(SolplanetCgiAdapter));
}

describe('SolplanetCgiAdapter robustness', () => {
  afterEach(async () => {
    nock.abortPendingRequests();
    nock.cleanAll();
  });

  it('resolves with offline state on HTTP 502 (no throw)', async () => {
    nock(BASE_URL)
      .get(/^\/getdevdata\.cgi/)
      .reply(502, 'Bad Gateway');

    const adapter = await makeAdapter();
    const state = await adapter.read();
    expect(state.isStale).toBe(true);
    expect(state.operatingState).toBe(M101_ST.OFF);
    expect(state.acPowerWatts).toBe(0);
    expect(state.acVoltageVolts).toBe(0);
    expect(state.acCurrentAmps).toBe(0);
    expect(state.gridFrequencyHz).toBe(0);
    expect(state.lifetimeEnergyKwh).toBe(0);
    // Identity is preserved from config even when offline.
    expect(state.vendorName).toBe('Solplanet');
    expect(state.serialNumber).toBe(SN);
  });

  it('resolves with offline state on HTTP 404', async () => {
    nock(BASE_URL).get(/^\/getdevdata\.cgi/).reply(404, 'Not Found');

    const adapter = await makeAdapter();
    const state = await adapter.read();
    expect(state.isStale).toBe(true);
    expect(state.operatingState).toBe(M101_ST.OFF);
  });

  it('resolves with offline state on JSON parse error', async () => {
    nock(BASE_URL)
      .get(/^\/getdevdata\.cgi/)
      .reply(200, '<html>not json at all</html>', {
        'Content-Type': 'text/html',
      });

    const adapter = await makeAdapter();
    const state = await adapter.read();
    expect(state.isStale).toBe(true);
    expect(state.operatingState).toBe(M101_ST.OFF);
  });

  it('resolves with offline state on connection refused', async () => {
    nock.disableNetConnect();
    nock(BASE_URL).get(/^\/getdevdata\.cgi/).replyWithError({
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED',
    });
    nock.enableNetConnect();

    const adapter = await makeAdapter();
    const state = await adapter.read();
    expect(state.isStale).toBe(true);
    expect(state.operatingState).toBe(M101_ST.OFF);
  });

  it('resolves with offline state on timeout', async () => {
    nock(BASE_URL)
      .get(/^\/getdevdata\.cgi/)
      .delay(2000) // longer than the 1000ms adapter timeout
      .reply(200, '{}');

    const adapter = await makeAdapter();
    const state = await adapter.read();
    expect(state.isStale).toBe(true);
    expect(state.operatingState).toBe(M101_ST.OFF);
  });

  it('coerces non-numeric and null fields to safe defaults', async () => {
    nock(BASE_URL)
      .get(/^\/getdevdata\.cgi/)
      .reply(200, {
        Pac: 'N/A',         // unparseable string
        Vac: null,          // explicit null
        Iac: 'x',           // unparseable string
        Fac: 50.0,
        'E-Total': null,    // explicit null
        WH: 12345.6,
        STATE: 'FAULT',     // string state maps to FAULT enum
      });

    const adapter = await makeAdapter();
    const state = await adapter.read();
    expect(state.isStale).toBe(false); // valid 2xx with parseable JSON
    expect(state.acPowerWatts).toBe(0);   // "N/A" → 0
    expect(state.acVoltageVolts).toBe(0); // null → 0
    expect(state.acCurrentAmps).toBe(0);  // "x" → 0
    expect(state.gridFrequencyHz).toBe(50.0);
    expect(state.lifetimeEnergyKwh).toBe(12345.6); // WH fallback, "E-Total" null → WH
    expect(state.operatingState).toBe(M101_ST.FAULT);
  });

  it('reads lifetime energy from E-Total when present', async () => {
    nock(BASE_URL)
      .get(/^\/getdevdata\.cgi/)
      .reply(200, {
        Pac: 4500, Vac: 230.5, Iac: 19.6, Fac: 50.02,
        'E-Total': 9999.5, WH: 12345.6,
        STATE: 'online',
      });

    const adapter = await makeAdapter();
    const state = await adapter.read();
    expect(state.isStale).toBe(false);
    expect(state.lifetimeEnergyKwh).toBe(9999.5); // E-Total wins over WH
    expect(state.acPowerWatts).toBe(4500);
    expect(state.operatingState).toBe(M101_ST.MPPT);
  });

  it('exposes vendorName and modelName for SunSpec Model 1 Mn/Md', async () => {
    nock(BASE_URL)
      .get(/^\/getdevdata\.cgi/)
      .reply(200, { Pac: 0, STATE: 'online' });

    const adapter = await makeAdapter();
    expect(adapter.vendorName).toBe('Solplanet');
    expect(adapter.modelName).toBe('ASW H-S2');
  });
});

describe('toFiniteNumber helper', () => {
  it.each([
    [42, 42],
    [3.14, 3.14],
    [-100, -100],
    ['230.5', 230.5],
    ['-12.3', -12.3],
    [0, 0],
  ])('parses %p → %p', (input, expected) => {
    expect(toFiniteNumber(input)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['N/A'], ['x'], [NaN], [Infinity], [{}], [[]]])(
    'returns null for %p',
    (input) => {
      expect(toFiniteNumber(input)).toBeNull();
    },
  );
});

describe('mapOperatingState helper', () => {
  it.each([
    ['online', M101_ST.MPPT],
    ['mppt', M101_ST.MPPT],
    ['running', M101_ST.MPPT],
    ['grid-connected', M101_ST.MPPT],
    ['normal', M101_ST.MPPT],
    ['sleeping', M101_ST.SLEEPING],
    ['standby', M101_ST.SLEEPING],
    ['idle', M101_ST.SLEEPING],
    ['starting', M101_ST.STARTING],
    ['startup', M101_ST.STARTING],
    ['fault', M101_ST.FAULT],
    ['error', M101_ST.FAULT],
    ['alarm', M101_ST.FAULT],
    ['off', M101_ST.OFF],
    ['shutdown', M101_ST.OFF],
    ['stopped', M101_ST.OFF],
    ['', M101_ST.OFF],
    ['garbage', M101_ST.OFF],
    [1, M101_ST.OFF],
    [4, M101_ST.MPPT],
    [7, M101_ST.FAULT],
  ])('maps %p → %p', (input, expected) => {
    expect(mapOperatingState(input)).toBe(expected);
  });
});
