import { Module } from '@nestjs/common';
import { TestSupportController } from './test-support.controller';
import { TestSupportGuard } from './test-support.guard';
import { TestSupportService } from './test-support.service';

@Module({
  controllers: [TestSupportController],
  providers: [TestSupportService, TestSupportGuard],
})
export class TestSupportModule {}
