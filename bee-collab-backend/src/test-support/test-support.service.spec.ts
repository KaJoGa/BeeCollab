import { PrismaService } from '../prisma/prisma.service';
import { TEST_EMAIL_SUFFIX } from './test-support.constants';
import { TestSupportService } from './test-support.service';

describe('TestSupportService', () => {
  function build() {
    const op = (name: string) => jest.fn((args: unknown) => ({ name, args }));
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]), deleteMany: op('user') },
      meeting: { findMany: jest.fn().mockResolvedValue([{ id: 'm1' }]), deleteMany: op('meeting') },
      participant: { deleteMany: op('participant') },
      chatMessage: { deleteMany: op('chat') },
      pollResponse: { deleteMany: op('pollResponse') },
      $transaction: jest.fn().mockResolvedValue([{ count: 1 }, { count: 2 }, { count: 3 }, { count: 4 }, { count: 5 }]),
    };
    return { prisma, service: new TestSupportService(prisma as unknown as PrismaService) };
  }

  it('only selects users by the test email suffix and meetings hosted by them', async () => {
    const { prisma, service } = build();
    await service.status();
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
      select: { id: true },
    });
    expect(prisma.meeting.findMany).toHaveBeenCalledWith({
      where: { hostId: { in: ['u1', 'u2'] } },
      select: { id: true },
    });
  });

  it('deletes in FK-safe order, scoped to the test users/meetings, in one transaction', async () => {
    const { prisma, service } = build();
    const result = await service.cleanup();

    const ops = (prisma.$transaction.mock.calls[0][0] as { name: string; args: unknown }[]).map((o) => o.name);
    expect(ops).toEqual(['pollResponse', 'chat', 'participant', 'meeting', 'user']);
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['u1', 'u2'] } } });
    expect(prisma.meeting.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['m1'] } } });
    expect(result).toEqual({
      deleted: { users: 5, meetings: 4, participants: 3, chatMessages: 2, pollResponses: 1 },
    });
  });

  it('with no test users, scopes every delete to empty id lists (matches nothing)', async () => {
    const { prisma, service } = build();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.meeting.findMany.mockResolvedValue([]);
    await service.cleanup();
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [] } } });
    expect(prisma.meeting.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [] } } });
  });
});
