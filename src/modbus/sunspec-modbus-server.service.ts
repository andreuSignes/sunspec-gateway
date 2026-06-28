import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServerTCP, IServiceVector } from 'modbus-serial';

import { InverterStateService } from '../state/inverter-state.service';
import { InverterState } from '../state/inverter-state.types';
import {
  EOM_SENTINEL,
  HOLDING_REGISTER_COUNT,
  M1,
  M101,
  SUNS_MAGIC_HI,
  SUNS_MAGIC_LO,
  writeSunSpecString,
  writeUint16,
} from './sunspec-registers';
import { encode, splitAcc32 } from './scale-factor';

/**
 * SunSpec Modbus TCP server.
 *
 * Owns a double-buffered register block (bufA / bufB) and exposes it over
 * Modbus TCP. The state bus writes the *inactive* buffer and atomically
 * flips `active` — a concurrent Modbus read sees the entire pre- or
 * post-write block, never a torn mix.
 *
 * Lifecycle:
 *   OnApplicationBootstrap → seed buffer with `snapshot()`, bind TCP socket.
 *   OnApplicationShutdown → close socket with a 5 s grace period.
 *
 * Handlers follow modbus-serial v8 IServiceVector signatures: every method
 * takes `unitID` as its last parameter and returns a `Promise`. Reads pull
 * from the active buffer only; writes reject with `read-only`.
 */
@Injectable()
export class SunSpecModbusServerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SunSpecModbusServerService.name);

  /** Double-buffer — two register blocks swapped atomically. */
  private readonly bufA: Buffer = Buffer.alloc(HOLDING_REGISTER_COUNT * 2);
  private readonly bufB: Buffer = Buffer.alloc(HOLDING_REGISTER_COUNT * 2);
  private active: 'A' | 'B' = 'A';

  /**
   * The currently-bound modbus-serial ServerTCP instance. The library's
   * TS type is `events.EventEmitter`-derived with a `close(cb)` method;
   * we narrow the surface to that one call.
   */
  private server: {
    close: (cb: (err: Error | null) => void) => void;
  } | null = null;

  /**
   * Last state projected into the active buffer. Used by
   * `readDeviceIdentification` so FC43 returns the vendor/model/serial.
   */
  private lastProjected: InverterState | null = null;

  constructor(
    private readonly bus: InverterStateService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Buffer accessors
  // ---------------------------------------------------------------------------

  private getActive(): Buffer {
    return this.active === 'A' ? this.bufA : this.bufB;
  }

  private getInactive(): Buffer {
    return this.active === 'A' ? this.bufB : this.bufA;
  }

  /**
   * Project the given state into the inactive buffer and atomically flip
   * `active`. Single-threaded JS makes the assignment truly atomic; a
   * Modbus read either sees the entire pre-write or post-write block.
   *
   * Called by `InverterPollingService` after each successful adapter read,
   * and once at bootstrap with the current `snapshot()`.
   */
  public refreshFromBus(state: InverterState): void {
    this.serveState(state, this.getInactive());
    this.active = this.active === 'A' ? 'B' : 'A';
    this.lastProjected = state;
  }

  // ---------------------------------------------------------------------------
  // Projection: InverterState → register buffer
  // ---------------------------------------------------------------------------

  /**
   * Project `InverterState` into the given buffer. Writes SunS magic, M1
   * header + identity block, M101 header + dynamic block, and the
   * end-of-models sentinel. Identity fields (`vendorName`, `modelName`,
   * `serialNumber`) come from the state; the Modbus unit ID is read
   * from config.
   */
  private serveState(state: InverterState, target: Buffer): void {
    // --- SunS magic (registers 0-1) ---
    writeUint16(target, 0, SUNS_MAGIC_HI);
    writeUint16(target, 1, SUNS_MAGIC_LO);

    // --- M1 header (registers 2-3) ---
    writeUint16(target, M1.ID, 1); // Model 1
    writeUint16(target, M1.L, M1.LENGTH);

    // --- M1 identity block ---
    const mnRegCount = M1.MN_END - M1.MN_START + 1; // 16
    const mdRegCount = M1.MD_END - M1.MD_START + 1; // 16
    const snRegCount = M1.SN_END - M1.SN_START + 1; // 16
    writeSunSpecString(target, M1.MN_START, state.vendorName, mnRegCount);
    writeSunSpecString(target, M1.MD_START, state.modelName, mdRegCount);
    // Opt/Vr left zeroed — not used in v1.
    writeSunSpecString(target, M1.SN_START, state.serialNumber, snRegCount);

    const unitId = this.config.get<number>('app.modbusUnitId') ?? 1;
    writeUint16(target, M1.DA, unitId);
    writeUint16(target, M1.PAD, 0);

    // --- M101 header (registers 70-71) ---
    writeUint16(target, M101.ID, 101);
    writeUint16(target, M101.L, M101.LENGTH);

    // --- M101 dynamic block ---
    // A (AC current, A) → M101.A + A_SF
    const a = encode(state.acCurrentAmps);
    writeUint16(target, M101.A, a.value);
    writeUint16(target, M101.A_SF, a.scaleFactor);

    // PhVphA (AC voltage phase A, V) → M101.PHVPHA + V_SF (shared with PPVph*)
    const v = encode(state.acVoltageVolts);
    writeUint16(target, M101.PHVPHA, v.value);
    writeUint16(target, M101.V_SF, v.scaleFactor);

    // W (AC power, W) → M101.W + W_SF. W is int16 on the wire.
    const w = encode(state.acPowerWatts);
    writeUint16(target, M101.W, w.value & 0xffff);
    writeUint16(target, M101.W_SF, w.scaleFactor);

    // Hz (Grid frequency, Hz) → M101.HZ + HZ_SF
    const hz = encode(state.gridFrequencyHz);
    writeUint16(target, M101.HZ, hz.value);
    writeUint16(target, M101.HZ_SF, hz.scaleFactor);

    // WH (lifetime energy, acc32) — convert kWh → Wh (SF=0).
    const wh = splitAcc32(Math.round(state.lifetimeEnergyKwh * 1000));
    writeUint16(target, M101.WH_HI, wh.hi);
    writeUint16(target, M101.WH_LO, wh.lo);
    writeUint16(target, M101.WH_SF, 0);

    // St (operating state) — numeric SunSpec enum 1..8, written as uint16.
    writeUint16(target, M101.ST, state.operatingState);

    // --- End-of-models sentinel ---
    writeUint16(target, HOLDING_REGISTER_COUNT - 2, EOM_SENTINEL);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Seed the buffer with the current bus snapshot, then bind the TCP socket.
   * Idempotent: subsequent calls are no-ops if the server is already up.
   */
  onApplicationBootstrap(): void {
    const snapshot = this.bus.snapshot();
    // Seed both buffers from the same starting state so a read on either
    // side of the first swap returns a valid SunSpec block.
    this.serveState(snapshot, this.bufA);
    this.serveState(snapshot, this.bufB);
    this.lastProjected = snapshot;

    const host = this.config.get<string>('app.modbusHost') ?? '0.0.0.0';
    const port = this.config.get<number>('app.modbusPort') ?? 5020;
    const unitID = this.config.get<number>('app.modbusUnitId') ?? 1;

    const vector = this.buildServiceVector();
    this.server = new ServerTCP(vector, { host, port, unitID });
    this.logger.log(
      `SunSpec Modbus TCP server bound to ${host}:${port} (unitID=${unitID})`,
    );
  }

  /**
   * Close the listening socket within `SHUTDOWN_TIMEOUT_MS` (default 5 s).
   * Uses `OnApplicationShutdown` per NestJS lifecycle docs — gives us a
   * graceful budget before the process exits.
   */
  async onApplicationShutdown(): Promise<void> {
    if (!this.server) return;
    const timeoutMs = this.config.get<number>('app.shutdownTimeoutMs') ?? 5_000;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn(
          `Modbus server did not close within ${timeoutMs}ms — forcing resolve`,
        );
        resolve();
      }, timeoutMs);
      this.server?.close((err: Error | null) => {
        clearTimeout(timer);
        if (err) {
          this.logger.warn(`Modbus server close error: ${err.message}`);
        } else {
          this.logger.log('Modbus server closed cleanly');
        }
        resolve();
      });
    });
    this.server = null;
  }

  // ---------------------------------------------------------------------------
  // modbus-serial IServiceVector
  // ---------------------------------------------------------------------------

  /**
   * Returns the IServiceVector consumed by `new ServerTCP(vector, opts)`.
   * Every handler reads from the active buffer; writes reject.
   *
   * Note: `IServiceVector` in modbus-serial v8's `.d.ts` omits
   * `readDeviceIdentification`, but the runtime handler in
   * `servertcp_handler.js` calls `vector.readDeviceIdentification(unitID)`.
   * We extend the type at the call site to keep `ServerTCP`'s constructor
   * happy.
   */
  private buildServiceVector(): IServiceVector {
    type ReadDeviceId = (unitID: number) => Record<number, string> | Promise<Record<number, string>>;
    type VectorWithReadDeviceId = IServiceVector & { readDeviceIdentification?: ReadDeviceId };

    const vector: VectorWithReadDeviceId = {
      getCoil: (_addr: number, _unitID: number): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getDiscreteInput: (_addr: number, _unitID: number): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getInputRegister: (_addr: number, _unitID: number): Promise<number> => {
        // SunSpec lives entirely on Holding Registers.
        return Promise.resolve(0);
      },
      getHoldingRegister: (addr: number, _unitID: number): Promise<number> => {
        return Promise.resolve(this.getActive().readUInt16BE(addr * 2));
      },
      getMultipleInputRegisters: (
        _addr: number,
        _length: number,
        _unitID: number,
      ): Promise<number[]> => {
        return Promise.resolve([]);
      },
      getMultipleHoldingRegisters: (
        addr: number,
        length: number,
        _unitID: number,
      ): number[] => {
        // modbus-serial v8's FC3 path treats a 3-param Promise-returning
        // handler as if it returned a sync array — `values.length` on a
        // Promise is `undefined`, so the lib aborts with "length mismatch"
        // (Modbus exception 0x04). Returning a sync array sidesteps that.
        // Buffer reads are non-blocking, so the sync shape is safe here.
        const buf = this.getActive();
        const out = new Array<number>(length);
        for (let i = 0; i < length; i++) {
          out[i] = buf.readUInt16BE((addr + i) * 2);
        }
        return out;
      },
      setCoil: (
        _addr: number,
        _value: boolean,
        _unitID: number,
      ): Promise<void> => {
        return Promise.reject(new Error('read-only'));
      },
      setRegister: (
        _addr: number,
        _value: number,
        _unitID: number,
      ): Promise<void> => {
        return Promise.reject(new Error('read-only'));
      },
      setRegisterArray: (
        _addr: number,
        _values: number[],
        _unitID: number,
      ): Promise<void> => {
        return Promise.reject(new Error('read-only'));
      },
      readDeviceIdentification: (
        _unitID: number,
      ): Record<number, string> => {
        const s = this.lastProjected;
        return {
          0x00: s?.vendorName ?? 'UNKNOWN',
          0x01: s?.modelName ?? 'UNKNOWN',
          0x02: s?.serialNumber ?? 'UNKNOWN',
        };
      },
    };
    return vector;
  }
}