import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TEST_EMAIL_SUFFIX } from './test-support.constants';

/**
 * QA helper: removes everything that belongs to test accounts.
 * Uses PrismaService directly (not a repository) on purpose — this is tooling,
 * not application logic.
 */
@Injectable()
export class TestSupportService {
  constructor(private readonly prisma: PrismaService) {}

  private async findTestScope() {
    const users = await this.prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    const meetings = await this.prisma.meeting.findMany({
      where: { hostId: { in: userIds } },
      select: { id: true },
    });
    return { userIds, meetingIds: meetings.map((m) => m.id) };
  }

  async status() {
    const { userIds, meetingIds } = await this.findTestScope();
    return {
      enabled: true,
      testEmailSuffix: TEST_EMAIL_SUFFIX,
      testUsers: userIds.length,
      testMeetings: meetingIds.length,
    };
  }

  /**
   * Deletes, in foreign-key-safe order, all rows that reference a test user or a
   * meeting hosted by one, then the meetings and the users themselves.
   * Run it while no test is executing (a row inserted mid-way can fail the user delete).
   */
  async cleanup() {
    const { userIds, meetingIds } = await this.findTestScope();

    const [pollResponses, chatMessages, participants, meetings, users] =
      await this.prisma.$transaction([
        this.prisma.pollResponse.deleteMany({
          where: {
            OR: [{ userId: { in: userIds } }, { poll: { meetingId: { in: meetingIds } } }],
          },
        }),
        this.prisma.chatMessage.deleteMany({
          where: {
            OR: [{ senderId: { in: userIds } }, { meetingId: { in: meetingIds } }],
          },
        }),
        this.prisma.participant.deleteMany({
          where: {
            OR: [{ userId: { in: userIds } }, { meetingId: { in: meetingIds } }],
          },
        }),
        // Cascades to Agenda, Poll (+PollOption, PollResponse) and Reaction.
        this.prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } }),
        this.prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);

    return {
      deleted: {
        users: users.count,
        meetings: meetings.count,
        participants: participants.count,
        chatMessages: chatMessages.count,
        pollResponses: pollResponses.count,
      },
    };
  }
}
