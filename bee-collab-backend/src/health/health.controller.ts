import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

const DB_TIMEOUT_MS = 8000;

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness + database readiness',
    description:
      'Always answers 200 once the server is up. `commit` is the deployed git SHA ("dev" locally) and `uptimeSeconds` shows restarts/cold starts. `db` is "up" after a successful `SELECT 1` ' +
      `(waits up to ${DB_TIMEOUT_MS / 1000}s, which also wakes a sleeping Neon database), otherwise "down". ` +
      'The frontend calls this on every page load to wake the free-tier backend.',
  })
  @ApiResponse({ status: 200, description: '`{ status, db: "up" | "down", commit, uptimeSeconds }` inside the ApiResponse envelope.' })
  async check() {
    return {
      status: 'ok',
      db: await this.dbStatus(),
      // Render injects RENDER_GIT_COMMIT; lets tests confirm which build is live.
      commit: (process.env.RENDER_GIT_COMMIT ?? 'dev').slice(0, 7),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  private async dbStatus(): Promise<'up' | 'down'> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('db timeout')), DB_TIMEOUT_MS);
        }),
      ]);
      return 'up';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = message.split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
      this.logger.warn(`DB check failed: ${reason}`);
      return 'down';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
