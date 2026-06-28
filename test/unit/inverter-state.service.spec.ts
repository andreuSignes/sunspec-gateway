import { InverterStateService } from '../../src/state/inverter-state.service';
import { InverterState, M101_ST } from '../../src/state/inverter-state.types';

const fresh = (overrides: Partial<InverterState> = {}): InverterState => ({
  acPowerWatts: 2340,
  acVoltageVolts: 230.5,
  acCurrentAmps: 10.16,
  gridFrequencyHz: 50.0,
  lifetimeEnergyKwh: 1234.5,
  operatingState: M101_ST.MPPT,
  vendorName: 'SOLPLANET',
  modelName: 'ASW3000H-S2',
  serialNumber: 'TEST-SN',
  isStale: false,
  lastUpdatedAt: 0, // sentinel — publish() will overwrite with Date.now()
  ...overrides,
});

describe('InverterStateService', () => {
  let service: InverterStateService;

  beforeEach(() => {
    service = new InverterStateService();
  });

  it('returns a safe empty state when no data has been published', () => {
    const s = service.snapshot();
    expect(s.operatingState).toBe(M101_ST.OFF);
    expect(s.isStale).toBe(true);
    expect(s.acPowerWatts).toBe(0);
    expect(s.acVoltageVolts).toBe(0);
    expect(s.acCurrentAmps).toBe(0);
    expect(s.gridFrequencyHz).toBe(0);
    expect(s.lifetimeEnergyKwh).toBe(0);
    expect(s.lastUpdatedAt).toBe(0);
  });

  it('publishes new state on each publish() call', () => {
    const s = fresh();
    service.publish(s);
    // publish() stamps lastUpdatedAt with Date.now(); compare without it.
    const { lastUpdatedAt: _ignored, ...rest } = service.snapshot();
    const { lastUpdatedAt: _ignored2, ...expected } = s;
    expect(rest).toEqual(expected);
  });

  it('publish() stamps lastUpdatedAt with Date.now() (bus owns the timestamp)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-28T12:00:00Z'));
    service.publish(fresh({ acPowerWatts: 1000 }));
    expect(service.snapshot().lastUpdatedAt).toBe(
      new Date('2026-06-28T12:00:00Z').getTime(),
    );
    jest.useRealTimers();
  });

  it('tracks the last good state separately', () => {
    service.publish(fresh({ acPowerWatts: 1000 }));
    service.publish(fresh({ acPowerWatts: 0, isStale: true }));
    expect(service.getLastGood()?.acPowerWatts).toBe(1000);
  });

  it('does NOT advance lastUpdatedAt when adapter publishes a stale state', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-28T12:00:00Z'));
    service.publish(fresh({ acPowerWatts: 1000 }));
    const t0 = service.snapshot().lastUpdatedAt;
    jest.advanceTimersByTime(5_000);
    service.publish(fresh({ acPowerWatts: 0, isStale: true }));
    // The stale publish did not bump lastUpdatedAt — it stays at T0.
    expect(service.snapshot().lastUpdatedAt).toBe(t0);
    jest.useRealTimers();
  });

  describe('stale detection', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-28T12:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('marks all production fields stale after 30s without a fresh poll, preserving lifetimeEnergyKwh', () => {
      service.publish(fresh({ acPowerWatts: 1500, lifetimeEnergyKwh: 1234.5 }));
      jest.advanceTimersByTime(31_000);
      // No second publish — the bus has not been polled for 31 s.
      const current = service.snapshot();
      expect(current.isStale).toBe(true);
      expect(current.operatingState).toBe(M101_ST.OFF);
      expect(current.acPowerWatts).toBe(0);
      expect(current.acVoltageVolts).toBe(0);
      expect(current.acCurrentAmps).toBe(0);
      expect(current.gridFrequencyHz).toBe(0);
      expect(current.lifetimeEnergyKwh).toBe(1234.5);
    });

    it('preserves identity fields (vendorName, modelName, serialNumber) on stale', () => {
      service.publish(fresh());
      jest.advanceTimersByTime(31_000);
      const current = service.snapshot();
      expect(current.vendorName).toBe('SOLPLANET');
      expect(current.modelName).toBe('ASW3000H-S2');
      expect(current.serialNumber).toBe('TEST-SN');
    });

    it('does not mark stale within the 30s threshold (single publish, 29s elapsed)', () => {
      service.publish(fresh({ acPowerWatts: 1500 }));
      jest.advanceTimersByTime(29_000);
      // No second publish — state should still be live within threshold.
      const current = service.snapshot();
      expect(current.isStale).toBe(false);
      expect(current.operatingState).toBe(M101_ST.MPPT);
      expect(current.acPowerWatts).toBe(1500);
    });

    it('restores live data after a fresh publish follows a stale period', () => {
      service.publish(fresh({ acPowerWatts: 1500, lifetimeEnergyKwh: 1234.5 }));
      jest.advanceTimersByTime(31_000);
      expect(service.snapshot().isStale).toBe(true);
      jest.advanceTimersByTime(1_000);
      service.publish(fresh({ acPowerWatts: 2000, lifetimeEnergyKwh: 1234.6 }));
      const restored = service.snapshot();
      expect(restored.isStale).toBe(false);
      expect(restored.acPowerWatts).toBe(2000);
      expect(restored.operatingState).toBe(M101_ST.MPPT);
    });
  });
});