import { InverterStateService } from '../../src/state/inverter-state.service';
import { InverterState } from '../../src/domain/inverter-state';

const fresh = (overrides: Partial<InverterState> = {}): InverterState => ({
  serialNumber: 'TEST-SN',
  acPowerWatts: 2340,
  acVoltage: 230.5,
  acCurrent: 10.16,
  acFrequency: 50.0,
  totalEnergyKwh: 1234.5,
  status: 'producing',
  lastUpdated: new Date(),
  isStale: false,
  ...overrides,
});

describe('InverterStateService', () => {
  let service: InverterStateService;

  beforeEach(() => {
    service = new InverterStateService();
  });

  it('returns a safe empty state when no data has been published', () => {
    const s = service.getState();
    expect(s.status).toBe('offline');
    expect(s.isStale).toBe(true);
    expect(s.acPowerWatts).toBe(0);
  });

  it('publishes new state on each setState call', () => {
    const s = fresh();
    service.setState(s);
    expect(service.getState()).toEqual(s);
  });

  it('tracks the last good state separately', () => {
    service.setState(fresh({ acPowerWatts: 1000 }));
    service.setState(fresh({ acPowerWatts: 0, isStale: true }));
    expect(service.getLastGood()?.acPowerWatts).toBe(1000);
  });

  describe('stale detection', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-28T12:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('marks state stale after 30s without a fresh poll', () => {
      service.setState(fresh({ acPowerWatts: 1500, isStale: false }));
      jest.advanceTimersByTime(31_000);
      service.setState(fresh({ acPowerWatts: 1500, isStale: false }));
      // After triggering setState past the threshold, current should be offline
      const current = service.getState();
      expect(current.status).toBe('offline');
      expect(current.acPowerWatts).toBe(0);
    });

    it('does not mark stale within the threshold', () => {
      service.setState(fresh({ acPowerWatts: 1500, isStale: false }));
      jest.advanceTimersByTime(29_000);
      service.setState(fresh({ acPowerWatts: 1500, isStale: false }));
      expect(service.getState().status).toBe('producing');
    });
  });
});
