import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { readTestSupportConfig, relatedEnvNames } from './test-support.config';
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
      // Only worth saying when the flag itself is missing: shows what *did* arrive.
      if (config.reason === 'TEST_SUPPORT_ENABLED is not set') {
        const names = relatedEnvNames();
        this.logger.log(
          names.length > 0
            ? `Environment variable names that look related (exact spelling, JSON-quoted): ${JSON.stringify(names)}`
            : 'No environment variable with TEST, SUPPORT, ADMIN or QA in its name reached this process: it was set on another service, or saved without redeploying this one.',
        );
      }
    }
  }
}
