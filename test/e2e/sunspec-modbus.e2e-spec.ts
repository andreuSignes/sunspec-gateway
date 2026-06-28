/**
 * E2E test for the SunSpec Modbus TCP server.
 *
 * Boots the gateway with a `FakeAdapter` that publishes a known
 * `InverterState`, then uses `modbus-serial` as a CLIENT to read the
 * register block and assert the projection matches the injected state.
 *
 * Uses port 5021 by default (override via `MODBUS_TEST_PORT`) to avoid
 * colliding with a dev server bound to 5020.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { setTimeout as wait } from 'timers/promises';
// `modbus-serial` exports `ModbusRTU` as the default export. At runtime
// the same object also carries `ServerTCP` / `ServerSerial` as properties.
import ModbusClient from 'modbus-serial';

type ModbusRTU = ModbusClient;

import { InverterStateService } from '../../src/state/inverter-state.service';
import {
  InverterAdapter,
  INVERTER_ADAPTER,
  InverterState,
  M101_ST,
} from '../../src/state/inverter-state.types';
import { SunSpecModbusServerService } from '../../src/modbus/sunspec-modbus-server.service';
import {
  HOLDING_REGISTER_COUNT,
  M1,
  M101,
  SUNS_MAGIC_HI,
  SUNS_MAGIC_LO,
} from '../../src/modbus/sunspec-registers';

/** Bind a different port than the dev server (5020). */
const TEST_PORT = Number(process.env['MODBUS_TEST_PORT'] ?? 5021);
const TEST_HOST = '127.0.0.1';
const TEST_UNIT_ID = 1;

/**
 * FakeAdapter — replaces the real Solplanet HTTP transport. `read()`
 * returns a deterministic state used by the test's assertions.
 */
class FakeAdapter extends InverterAdapter {
  public override readonly vendorName = 'TEST_VENDOR';
  public override readonly modelName = 'TEST_MODEL_X1';
  /** Optional override for stale / offline scenarios. */
  public nextState: InverterState;

  constructor(state: InverterState) {
    super();
    this.nextState = state;
  }

  override async read(): Promise<InverterState> {
    return this.nextState;
  }
}

/**
 * Wait until `host:port` accepts a TCP connection, polling every 50 ms up
 * to `maxMs` ms total. Returns true on success, false on timeout.
 */
async function waitForPort(
  host: string,
  port: number,
  maxMs = 5_000,
): Promise<boolean> {
  const net = await import('net');
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await wait(50);
  }
  return false;
}

/**
 * Decode an unsigned int32 stored big-endian across two uint16 registers.
 */
function joinAcc32(hi: number, lo: number): number {
  return (hi << 16) + lo;
}

/**
 * Decode a SunSpec value as `raw * 10^sf` (sf is signed).
 */
function decode(raw: number, sf: number): number {
  return raw * Math.pow(10, sf);
}

/**
 * SunSpec `sunssf` and `int16` register types are signed int16 on the
 * wire. modbus-serial returns the raw uint16 (0..65535), so a negative
 * SF like -1 reads back as 0xFFFF (= 65535 unsigned). Convert to signed.
 */
function toInt16(raw: number): number {
  return raw > 0x7fff ? raw - 0x10000 : raw;
}

describe('SunSpecModbusServer e2e (modbus-serial client)', () => {
  let app: TestingModule;
  // `_modbusServer` is bound into NestJS DI but never directly referenced
  // by the tests — the projection pulls identity fields from `fakeState`
  // directly, and the server's behaviour is observed via the modbus
  // client reads below.
  let _modbusServer: SunSpecModbusServerService;
  // `_fake` is bound into NestJS DI but never directly referenced by the
  // tests — the projection pulls identity fields from `fakeState` directly.
  let _fake: FakeAdapter;
  let client: ModbusRTU;

  // Injected values — chosen so each SF path is exercised:
  //   acCurrentAmps=10.2     → SF=-1 (raw=102)
  //   acVoltageVolts=230.5   → SF=-1 (raw=2305)
  //   acPowerWatts=4500      → SF= 0 (raw=4500)
  //   gridFrequencyHz=50.02   → SF=-1 (raw=500) — 50.0 would yield SF=0
  //                            (integer) per the scale-factor algorithm,
  //                            so we use a fractional value to exercise
  //                            a non-zero SF path.
  //   lifetimeEnergyKwh=12.345 → WH=12345 Wh, SF=0
  //   operatingState=MPPT=4
  const fakeState: InverterState = {
    acCurrentAmps: 10.2,
    acVoltageVolts: 230.5,
    acPowerWatts: 4500,
    gridFrequencyHz: 50.1,
    lifetimeEnergyKwh: 12.345,
    operatingState: M101_ST.MPPT,
    vendorName: 'TEST_VENDOR',
    modelName: 'TEST_MODEL_X1',
    serialNumber: 'SN-ABCDEF-1234',
    isStale: false,
    lastUpdatedAt: 0,
  };

  beforeAll(async () => {
    _fake = new FakeAdapter(fakeState);

    const moduleRef = await Test.createTestingModule({
      providers: [
        InverterStateService,
        SunSpecModbusServerService,
        {
          provide: INVERTER_ADAPTER,
          useExisting: FakeAdapter,
        },
        FakeAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string): unknown => {
              const map: Record<string, unknown> = {
                'app.modbusHost': TEST_HOST,
                'app.modbusPort': TEST_PORT,
                'app.modbusUnitId': TEST_UNIT_ID,
                'app.shutdownTimeoutMs': 2_000,
              };
              return map[key];
            },
          },
        },
      ],
    }).compile();

    app = moduleRef;
    const bus = app.get(InverterStateService);
    _modbusServer = app.get(SunSpecModbusServerService);

    // Publish the deterministic state to the bus FIRST so that
    // OnApplicationBootstrap's `bus.snapshot()` returns the live state
    // instead of the cold-start empty state — otherwise both buffers get
    // overwritten with zeros / `operatingState = OFF`.
    bus.publish(fakeState);

    await app.init();

    const ok = await waitForPort(TEST_HOST, TEST_PORT);
    if (!ok) {
      throw new Error(
        `Modbus server did not bind to ${TEST_HOST}:${TEST_PORT} within 5s`,
      );
    }

    client = new ModbusClient();
    await client.connectTCP(TEST_HOST, { port: TEST_PORT });
    client.setID(TEST_UNIT_ID);
    client.setTimeout(2_000);
  }, 30_000);

  afterAll(async () => {
    try {
      client?.close(() => undefined);
    } catch {
      // ignore — best-effort cleanup
    }
    if (app) {
      await app.close();
    }
  });

  it('writes SunS magic at registers 0-1', async () => {
    const r = await client.readHoldingRegisters(0, 2);
    expect(r.data[0]).toBe(SUNS_MAGIC_HI);
    expect(r.data[1]).toBe(SUNS_MAGIC_LO);
  });

  it('writes M1 ID and L at registers 2-3', async () => {
    const r = await client.readHoldingRegisters(M1.ID, 2);
    expect(r.data[0]).toBe(1);
    expect(r.data[1]).toBe(M1.LENGTH);
  });

  it('writes M1.Mn vendor string at registers 4-19', async () => {
    const regCount = M1.MN_END - M1.MN_START + 1; // 16
    const r = await client.readHoldingRegisters(M1.MN_START, regCount);
    // Each register is BE uint16: high byte first. Two chars per register.
    const bytes = Buffer.alloc(regCount * 2);
    for (let i = 0; i < regCount; i++) {
      bytes.writeUInt16BE(r.data[i] & 0xffff, i * 2);
    }
    const decoded = bytes.toString('ascii').replace(/\0+$/, '');
    expect(decoded).toBe('TEST_VENDOR');
  });

  it('writes M101 ID and L at registers 70-71', async () => {
    const r = await client.readHoldingRegisters(M101.ID, 2);
    expect(r.data[0]).toBe(101);
    expect(r.data[1]).toBe(M101.LENGTH);
  });

  it('encodes W (AC power) with W_SF scale factor', async () => {
    const r = await client.readHoldingRegisters(M101.W, 2);
    const raw = r.data[0];
    const sf = toInt16(r.data[1]);
    expect(sf).toBe(0);
    expect(decode(raw, sf)).toBeCloseTo(fakeState.acPowerWatts, 6);
  });

  it('encodes PhVphA (AC voltage) with V_SF scale factor', async () => {
    const r = await client.readHoldingRegisters(M101.PHVPHA, 1);
    const sfResp = await client.readHoldingRegisters(M101.V_SF, 1);
    const raw = r.data[0];
    const sf = toInt16(sfResp.data[0]);
    expect(sf).toBe(-1);
    expect(decode(raw, sf)).toBeCloseTo(fakeState.acVoltageVolts, 6);
  });

  it('encodes A (AC current) with A_SF scale factor', async () => {
    const r = await client.readHoldingRegisters(M101.A, 1);
    const sfResp = await client.readHoldingRegisters(M101.A_SF, 1);
    const raw = r.data[0];
    const sf = toInt16(sfResp.data[0]);
    expect(sf).toBe(-1);
    expect(decode(raw, sf)).toBeCloseTo(fakeState.acCurrentAmps, 6);
  });

  it('encodes HZ (grid frequency) with HZ_SF scale factor', async () => {
    const r = await client.readHoldingRegisters(M101.HZ, 1);
    const sfResp = await client.readHoldingRegisters(M101.HZ_SF, 1);
    const raw = r.data[0];
    const sf = toInt16(sfResp.data[0]);
    expect(sf).toBe(-1);
    expect(decode(raw, sf)).toBeCloseTo(fakeState.gridFrequencyHz, 6);
  });

  it('encodes ST (operating state) directly as SunSpec enum', async () => {
    const r = await client.readHoldingRegisters(M101.ST, 1);
    expect(r.data[0]).toBe(fakeState.operatingState);
    expect(r.data[0]).toBe(M101_ST.MPPT);
  });

  it('encodes WH (lifetime energy) as int32 BE with WH_SF', async () => {
    const r = await client.readHoldingRegisters(M101.WH_HI, 2);
    const sfResp = await client.readHoldingRegisters(M101.WH_SF, 1);
    const whRaw = joinAcc32(r.data[0], r.data[1]); // Wh
    const sf = toInt16(sfResp.data[0]);
    expect(sf).toBe(0);
    // 12.345 kWh * 1000 = 12345 Wh
    expect(whRaw).toBe(12345);
    expect(decode(whRaw, sf) / 1000).toBeCloseTo(fakeState.lifetimeEnergyKwh, 3);
  });

  it('writes the EOM sentinel at register 122', async () => {
    const r = await client.readHoldingRegisters(
      HOLDING_REGISTER_COUNT - 2,
      1,
    );
    expect(r.data[0]).toBe(0xffff);
  });

  it('rejects writes with read-only error', async () => {
    await expect(
      client.writeRegister(M101.W, 0),
    ).rejects.toThrow();
  });
});