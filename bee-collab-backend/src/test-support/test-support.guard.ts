import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { MIN_TOKEN_LENGTH } from './test-support.constants';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Gate for the QA support endpoints.
 *  - Disabled (default) or misconfigured → 404, indistinguishable from an unknown route.
 *  - Enabled but missing/wrong `x-test-token` header → 401.
 * Enable with TEST_SUPPORT_ENABLED=true and TEST_ADMIN_TOKEN=<16+ chars>.
 */
@Injectable()
export class TestSupportGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = process.env.TEST_ADMIN_TOKEN ?? '';

    if (process.env.TEST_SUPPORT_ENABLED !== 'true' || expected.length < MIN_TOKEN_LENGTH) {
      throw new NotFoundException(`Cannot ${req.method} ${req.originalUrl}`);
    }

    const provided = req.header('x-test-token') ?? '';
    if (!safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid test token');
    }
    return true;
  }
}
