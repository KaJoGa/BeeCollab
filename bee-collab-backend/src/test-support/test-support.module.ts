import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { readTestSupportConfig } from './test-support.config';
import { TestSupportController } from './test-support.controller';
import { TestSupportGuard } from './test-support.guard';
import { TestSupportService } from './test-support.service';

@Module({
  controllers: [TestSupportController],
  providers: [TestSupportService, TestSupportGuard],
})
export class TestSupportModule implements OnModuleInit {
  private readonly logger = new Logger('TestSupport');

  /** One startup line so a hosting dashboard's logs explain why /test-support/* answers 404. */
  onModuleInit() {
    const config = readTestSupportConfig();
    if (config.enabled) {
      this.logger.warn(
        `QA endpoints ENABLED (/test-support/status, /test-support/cleanup; token length ${config.token.length}). Disable by removing TEST_SUPPORT_ENABLED.`,
      );
    } else {
      this.logger.log(`QA endpoints disabled: ${config.reason}`);
    }
  }
}
