import { InverterAdapter, INVERTER_ADAPTER, InverterState } from '../../state/inverter-state.types';

/**
 * Re-export the abstract class and DI token so adapters and consumers
 * can import them from the gateway module without crossing into state/.
 */
export { InverterAdapter, INVERTER_ADAPTER, type InverterState };