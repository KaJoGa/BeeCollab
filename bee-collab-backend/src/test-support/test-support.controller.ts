import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { TestSupportGuard } from './test-support.guard';
import { TestSupportService } from './test-support.service';

/** Hidden from Swagger. 404 unless TEST_SUPPORT_ENABLED=true — see TestSupportGuard. */
@ApiExcludeController()
@UseGuards(TestSupportGuard)
@Controller('test-support')
export class TestSupportController {
  constructor(private readonly service: TestSupportService) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  @Post('cleanup')
  @HttpCode(200)
  cleanup() {
    return this.service.cleanup();
  }
}
