import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RepositoryModule } from './repositories/repository.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MeetingsModule } from './meetings/meetings.module';
import { ChatModule } from './chat/chat.module';
import { SignalingModule } from './signaling/signaling.module';
import { EventsModule } from './events/events.module';
import { WebrtcModule } from './webrtc/webrtc.module';
import { TestSupportModule } from './test-support/test-support.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // EventEmitterModule must be global so EventEmitter2 can be injected
    // in any service without an explicit import.
    EventEmitterModule.forRoot({ wildcard: false, global: true }),
    PrismaModule,
    RepositoryModule,
    AuthModule,
    UsersModule,
    MeetingsModule,
    ChatModule,
    SignalingModule,
    EventsModule,
    WebrtcModule,
    TestSupportModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule { }
