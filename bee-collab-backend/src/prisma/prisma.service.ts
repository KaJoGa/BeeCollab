import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private pool: Pool;

  constructor() {
    // Prisma v7: gunakan Driver Adapter (pg) sebagai ganti datasource di schema
    // Ini support Supabase connection pooler (PgBouncer/Supavisor)
    const connectionString = process.env.DATABASE_URL;

    // Neon scales to zero and drops idle connections: allow a slow cold start,
    // keep the pool small, and never let an idle-client error crash the process.
    const pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      new Logger(PrismaService.name).warn(`Idle DB client error: ${err.message}`);
    });
    const adapter = new PrismaPg(pool);

    super({ adapter });

    // Simpan pool agar bisa di-destroy saat shutdown
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('✅ Prisma connected to PostgreSQL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
    this.logger.log('Prisma disconnected');
  }
}
