import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import type { IMeetingRepository } from '../repositories/interfaces/meeting.repository.interface';
import type { IParticipantRepository } from '../repositories/interfaces/participant.repository.interface';
import type { IChatRepository } from '../repositories/interfaces/chat.repository.interface';
import {
  MEETING_REPOSITORY,
  PARTICIPANT_REPOSITORY,
  CHAT_REPOSITORY,
} from '../repositories/tokens';
import { SignalingGateway } from '../signaling/signaling.gateway';
import { MeetingEndedEvent } from '../events/meeting.events';

@Injectable()
export class MeetingsCleanupService {
  private readonly logger = new Logger(MeetingsCleanupService.name);
  private running = false;

  constructor(
    @Inject(MEETING_REPOSITORY)
    private readonly meetingRepository: IMeetingRepository,
    @Inject(PARTICIPANT_REPOSITORY)
    private readonly participantRepository: IParticipantRepository,
    @Inject(CHAT_REPOSITORY)
    private readonly chatRepository: IChatRepository,
    private readonly signalingGateway: SignalingGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Interval(30000)
  async closeExpiredMeetings() {
    if (this.running) return;

    this.running = true;
    try {
      const now = new Date();
      const meetings = await this.meetingRepository.findLiveMeetings();

      const expired = meetings.filter((meeting) => {
        if (!meeting.startedAt) return false;
        const endsAt = new Date(
          meeting.startedAt.getTime() + meeting.duration * 60_000,
        );
        return endsAt <= now;
      });

      for (const meeting of expired) {
        // Notify WebSocket clients the meeting has expired
        this.signalingGateway.emitMeetingEnded(
          meeting.id,
          'The meeting time has ended (duration limit reached).',
        );

        await this.participantRepository.deleteMany(meeting.id);
        await this.chatRepository.deleteMany(meeting.id);
        await this.meetingRepository.delete(meeting.id);

        // Publish: meeting ended due to duration expiry
        this.eventEmitter.emit(
          'meeting.ended',
          new MeetingEndedEvent(meeting.id, 'expired'),
        );
      }

      if (expired.length > 0) {
        this.logger.log(`Auto-ended ${expired.length} meeting(s)`);
      }
    } finally {
      this.running = false;
    }
  }
}
