/**
 * Liveness probe.
 *
 * `GET /healthz` returns 200 with `{ status: 'ok' }` as long as the
 * NestJS HTTP server is up. No deps, no auth, no inverter check — the
 * `SunSpecModbusServerService` and the inverter polling are independent
 * concerns; a degraded inverter does not mean the gateway itself is
 * unhealthy.
 *
 * For deeper checks (e.g. "is the inverter reachable?"), add a separate
 * `/readyz` endpoint later — `/healthz` stays cheap so a Kubernetes /
 * Docker restart loop can hammer it without cost.
 */
import { Controller, Get } from '@nestjs/common';

@Controller('healthz')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}