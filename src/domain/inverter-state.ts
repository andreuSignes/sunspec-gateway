/**
 * Vendor-agnostic snapshot of inverter telemetry.
 *
 * Every value is in REAL UNITS (volts, amps, watts, kWh). Scale-factor
 * conversion happens at the Modbus projection layer, not here.
 */
export type InverterStatus =
  | 'producing'
  | 'starting'
  | 'idle'
  | 'offline'
  | 'error';

export interface InverterState {
  /** Stable inverter identifier (vendor serial or fallback). */
  serialNumber: string;

  /** AC output — single phase. */
  acPowerWatts: number;
  acVoltage: number;
  acCurrent: number;
  acFrequency: number;

  /** DC input (PV string). Optional — some adapters don't expose DC. */
  dcPowerWatts?: number;
  dcVoltage?: number;
  dcCurrent?: number;

  /** Energy. kWh for human-friendly; Modbus layer converts to Wh (acc32). */
  totalEnergyKwh: number;
  dailyEnergyKwh?: number;

  /** Operating status. */
  status: InverterStatus;

  /** Internal temperature in °C. Optional. */
  temperatureC?: number;

  /** Provenance. */
  lastUpdated: Date;
  isStale: boolean;
}
