import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignalingService } from './signaling.service';
import { ChatService } from '../chat/chat.service';
import { AgendaService } from '../meetings/agenda.service';
import { PollService } from '../meetings/poll.service';
import { ReactionService } from '../meetings/reaction.service';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { SocketData, WsUser } from './signaling.types';
import { ParticipantMediaChangedEvent } from '../events/meeting.events';
import { getAllowedOrigins } from '../common/cors';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Extract the verified user from socket.data (set by WsJwtGuard) */
function getUser(client: Socket): WsUser {
  const data = client.data as SocketData;
  if (!data?.user?.sub) throw new WsException('Unauthorized');
  return data.user;
}

// ─── Event Payload Interfaces ─────────────────────────────────────────────────

interface JoinPayload {
  meetingId: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}

interface WebRtcPayload {
  to: string;
  from: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface MediaTogglePayload {
  meetingId: string;
  type: 'audio' | 'video';
  enabled: boolean;
}

interface ChatPayload {
  meetingId: string;
  message: string;
}

interface EndMeetingPayload {
  meetingId: string;
}

interface HandTogglePayload {
  meetingId: string;
  raised: boolean;
}

interface KickPayload {
  meetingId: string;
  targetSocketId: string;
}

interface AskUnmutePayload {
  meetingId: string;
  targetSocketId: string;
}

interface MakeCoHostPayload {
  meetingId: string;
  targetUserId: string;
}

interface RemoveCoHostPayload {
  meetingId: string;
  targetUserId: string;
}

// ─── Gateway ──────────────────────────────────────────────────────────────────

@WebSocketGateway({
  namespace: '/meetings',
  cors: { origin: getAllowedOrigins() },
})
export class SignalingGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly signalingService: SignalingService,
    private readonly chatService: ChatService,
    private readonly agendaService: AgendaService,
    private readonly pollService: PollService,
    private readonly reactionService: ReactionService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  emitMeetingEnded(meetingId: string, reason?: string) {
    if (!this.server) return;
    this.server.to(meetingId).emit('meeting:ended', { meetingId, reason });
  }

  /** Returns the number of active socket connections in a meeting room */
  async getRoomSocketCount(meetingId: string): Promise<number> {
    if (!this.server) return 0;
    const sockets = await this.server.in(meetingId).fetchSockets();
    return sockets.length;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth as Record<string, string | undefined>).token ??
      client.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      client.emit('error', { message: 'No token provided' });
      client.disconnect();
      return;
    }

    console.log(`[WS] Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const data = client.data as SocketData;
    const participant = await this.signalingService.handleDisconnect(client.id);

    if (participant) {
      // Registered user — DB record updated by service
      this.server.to(participant.meetingId).emit('participant:left', {
        socketId: client.id,
        userId: participant.userId,
        user: participant.user,
      });
    } else if (data?.user?.isGuest && data?.meetingId) {
      // Guest user — no DB record, emit leave using socket.data
      this.server.to(data.meetingId).emit('participant:left', {
        socketId: client.id,
        userId: data.user.sub,
        user: data.profile,
      });
    }

    // Refresh the speaking queue so a leaver with a raised hand is removed
    // (exclude this socket — it may still appear in the room map momentarily).
    const meetingId = participant?.meetingId ?? data?.meetingId;
    if (meetingId) {
      const queue = await this.buildSpeakingQueue(meetingId, client.id);
      this.server.to(meetingId).emit('queue:updated', queue);
    }

    console.log(`[WS] Client disconnected: ${client.id}`);
  }

  // ── meeting:join ─────────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('meeting:join')
  async onMeetingJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinPayload,
  ) {
    const user = getUser(client);

    // Disconnect duplicate tabs for the same user in this meeting
    const existingSockets = await this.server.in(payload.meetingId).fetchSockets();
    for (const socket of existingSockets) {
      if ((socket.data as SocketData).user?.sub === user.sub && socket.id !== client.id) {
        socket.emit('error', { message: 'Opened in another tab. This connection was closed.' });
        socket.disconnect();
      }
    }

    // ── Capacity check ─────────────────────────────────────────────────────────
    // Enforce maxParticipants here (the WS join is the real entry point — guests
    // and the REST flow both ultimately arrive here). Count DISTINCT users already
    // in the room, excluding this user so reconnects/rejoins never falsely fill a slot.
    const maxParticipants = await this.signalingService.getMaxParticipants(payload.meetingId);
    if (maxParticipants && maxParticipants > 0) {
      const roomSockets = await this.server.in(payload.meetingId).fetchSockets();
      const distinctOtherUsers = new Set<string>();
      for (const s of roomSockets) {
        const sub = (s.data as SocketData).user?.sub;
        if (sub && sub !== user.sub) distinctOtherUsers.add(sub);
      }
      if (distinctOtherUsers.size >= maxParticipants) {
        client.emit('meeting:full', {
          message: `This meeting is full (max ${maxParticipants} participants).`,
        });
        client.disconnect();
        return;
      }
    }

    // Always store meetingId so handleDisconnect can reference it for guests
    client.data.meetingId = payload.meetingId;

    let profile: { id: string; name: string; avatarUrl: string | null };
    let role: 'HOST' | 'CO_HOST' | 'PARTICIPANT' = 'PARTICIPANT';
    let audioEnabled = payload.audioEnabled ?? false;
    let videoEnabled = payload.videoEnabled ?? false;

    if (user.isGuest) {
      // ── Guest path: no DB operations, identity lives in the JWT ───────────
      profile = { id: user.sub, name: user.name ?? 'Guest', avatarUrl: null };
      // Ensure the meeting transitions SCHEDULED → LIVE even for guest-only joins
      await this.signalingService.startMeetingIfScheduled(payload.meetingId);
    } else {
      // ── Registered user path: persist to DB ───────────────────────────────
      const participant = await this.signalingService.handleJoin(
        payload.meetingId,
        user.sub,
        client.id,
        audioEnabled,
        videoEnabled,
      );
      profile = {
        id: participant.user.id,
        name: participant.user.name,
        avatarUrl: participant.user.avatarUrl,
      };
      role = participant.role as 'HOST' | 'CO_HOST' | 'PARTICIPANT';
      audioEnabled = participant.audioEnabled;
      videoEnabled = participant.videoEnabled;
    }

    await client.join(payload.meetingId);

    client.to(payload.meetingId).emit('participant:joined', {
      socketId: client.id,
      userId: user.sub,
      user: profile,
      role,
      audioEnabled,
      videoEnabled,
    });

    client.data.profile = profile;
    client.data.audioEnabled = audioEnabled;
    client.data.videoEnabled = videoEnabled;
    client.data.role = role;

    const sockets = await this.server.in(payload.meetingId).fetchSockets();
    client.emit('meeting:state', {
      meetingId: payload.meetingId,
      participants: sockets.map((s) => ({
        socketId: s.id,
        userId: (s.data as SocketData).user?.sub,
        user: (s.data as SocketData).profile,
        role: (s.data as SocketData).role,
        audioEnabled: (s.data as SocketData).audioEnabled,
        videoEnabled: (s.data as SocketData).videoEnabled,
      })),
    });

    // Send chat history to the new participant
    const history = await this.chatService.getMessages(payload.meetingId);
    client.emit('chat:history', history);

    // Fetch and send agendas and polls
    const [agendas, polls] = await Promise.all([
      this.agendaService.getAgendas(payload.meetingId),
      this.pollService.getPolls(payload.meetingId),
    ]);
    client.emit('agenda:list', agendas);
    client.emit('poll:list', polls);
  }

  // ── WebRTC relay ─────────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('webrtc:offer')
  onOffer(@MessageBody() payload: WebRtcPayload) {
    this.server.to(payload.to).emit('webrtc:offer', payload);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('webrtc:answer')
  onAnswer(@MessageBody() payload: WebRtcPayload) {
    this.server.to(payload.to).emit('webrtc:answer', payload);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('webrtc:ice-candidate')
  onIceCandidate(@MessageBody() payload: WebRtcPayload) {
    this.server.to(payload.to).emit('webrtc:ice-candidate', payload);
  }

  // ── Media toggle ──────────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('media:toggle')
  async onMediaToggle(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MediaTogglePayload,
  ) {
    const user = getUser(client);
    const data = client.data as SocketData;

    // Update socket.data immediately (used by meeting:state snapshots)
    if (payload.type === 'audio') {
      client.data.audioEnabled = payload.enabled;
    } else {
      client.data.videoEnabled = payload.enabled;
    }

    // Guests have no DB participant row — skip DB write, use socket.data as source of truth
    let userProfile = data.profile ?? { id: user.sub, name: user.name ?? 'Guest', avatarUrl: null };

    if (!user.isGuest) {
      const updated = await this.signalingService.toggleMedia(
        payload.meetingId,
        user.sub,
        payload.type,
        payload.enabled,
      );
      userProfile = updated.user;
    }

    this.server.to(payload.meetingId).emit('media:updated', {
      socketId: client.id,
      userId: user.sub,
      user: userProfile,
      type: payload.type,
      enabled: payload.enabled,
    });

    // Publish domain event (Observer Pattern)
    this.eventEmitter.emit(
      'participant.media_changed',
      new ParticipantMediaChangedEvent(
        payload.meetingId,
        user.sub,
        payload.type,
        payload.enabled,
      ),
    );
  }

  @SubscribeMessage('media:speaking')
  onMediaSpeaking(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; speaking: boolean },
  ) {
    client.to(payload.meetingId).emit('media:speaking', {
      socketId: client.id,
      speaking: payload.speaking,
    });
  }

  // ── Chat ──────────────────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('chat:message')
  async onChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ChatPayload,
  ) {
    const user = getUser(client);
    const data = client.data as SocketData;

    if (user.isGuest) {
      // Guests have no User row, so ChatMessage.senderId (FK → User.id) can't be
      // persisted. Broadcast an in-memory message instead (not saved to history).
      const guestMessage = {
        id: randomUUID(),
        meetingId: payload.meetingId,
        senderId: user.sub,
        message: payload.message,
        type: 'TEXT',
        createdAt: new Date().toISOString(),
        sender: {
          id: user.sub,
          name: data.profile?.name ?? user.name ?? 'Guest',
          avatarUrl: data.profile?.avatarUrl ?? null,
        },
      };
      this.server.to(payload.meetingId).emit('chat:message', guestMessage);
      return;
    }

    const saved = await this.chatService.saveMessage(
      payload.meetingId,
      user.sub,
      payload.message,
    );
    this.server.to(payload.meetingId).emit('chat:message', saved);
  }

  // ── Meeting end ───────────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('meeting:end')
  async onEndMeeting(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: EndMeetingPayload,
  ) {
    const user = getUser(client);
    const meeting = await this.signalingService.endMeeting(
      payload.meetingId,
      user.sub,
    );

    if (!meeting) {
      client.emit('error', { message: 'Unauthorized or meeting not found' });
      return;
    }

    this.server
      .to(payload.meetingId)
      .emit('meeting:ended', { meetingId: payload.meetingId });
  }

  // ── Hand raise ──────────────────────────────────────────────────────────────

  // ── Speaking-queue helpers ────────────────────────────────────────────────────

  /** Local (writable) sockets currently in a meeting room — single-node. */
  private getLocalRoomSockets(meetingId: string, excludeSocketId?: string): Socket[] {
    const map = (this.server as unknown as { sockets?: Map<string, Socket> }).sockets;
    if (!map) return [];
    const result: Socket[] = [];
    for (const s of map.values()) {
      if (s.id === excludeSocketId) continue;
      if (s.rooms?.has(meetingId)) result.push(s);
    }
    return result;
  }

  /**
   * Build the combined speaking queue: registered users (from DB) + guests
   * (from socket.data, since they have no Participant row), sorted by raise time.
   */
  private async buildSpeakingQueue(meetingId: string, excludeSocketId?: string) {
    const dbQueue = await this.signalingService.getSpeakingQueue(meetingId);
    const entries: { userId: string; user: unknown; handRaisedAt: Date }[] =
      dbQueue.map((p) => ({
        userId: p.userId,
        user: p.user,
        handRaisedAt: p.handRaisedAt as Date,
      }));

    for (const s of this.getLocalRoomSockets(meetingId, excludeSocketId)) {
      const d = s.data as SocketData;
      if (d.user?.isGuest && d.handRaisedAt) {
        entries.push({
          userId: d.user.sub,
          user: d.profile ?? { id: d.user.sub, name: d.user.name ?? 'Guest', avatarUrl: null },
          handRaisedAt: new Date(d.handRaisedAt),
        });
      }
    }

    return entries
      .sort((a, b) => a.handRaisedAt.getTime() - b.handRaisedAt.getTime())
      .map((e) => ({ userId: e.userId, user: e.user, handRaisedAt: e.handRaisedAt }));
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('hand:toggle')
  async onHandToggle(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HandTogglePayload,
  ) {
    const user = getUser(client);

    if (user.isGuest) {
      // Guests have no Participant row — keep hand state on the socket
      client.data.handRaisedAt = payload.raised ? new Date().toISOString() : null;
    } else {
      await this.signalingService.toggleHand(payload.meetingId, user.sub, payload.raised);
    }

    const queue = await this.buildSpeakingQueue(payload.meetingId);
    this.server.to(payload.meetingId).emit('queue:updated', queue);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('queue:reorder')
  async onQueueReorder(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; orderedUserIds: string[] },
  ) {
    const user = getUser(client);
    const canReorder = await this.signalingService.isHostOrCoHost(payload.meetingId, user.sub);
    if (!canReorder) return;

    // Map guest userId → writable socket so we can reorder guests too
    const guestByUser = new Map<string, Socket>();
    for (const s of this.getLocalRoomSockets(payload.meetingId)) {
      const d = s.data as SocketData;
      if (d.user?.isGuest) guestByUser.set(d.user.sub, s);
    }

    const now = Date.now();
    for (let i = 0; i < payload.orderedUserIds.length; i++) {
      const uid = payload.orderedUserIds[i];
      const ts = new Date(now + i * 1000);
      const guestSocket = guestByUser.get(uid);
      if (guestSocket) {
        guestSocket.data.handRaisedAt = ts.toISOString();
      } else {
        await this.signalingService.setHandRaisedAt(payload.meetingId, uid, ts);
      }
    }

    const queue = await this.buildSpeakingQueue(payload.meetingId);
    this.server.to(payload.meetingId).emit('queue:updated', queue);
  }

  // ── Agenda ───────────────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('agenda:create')
  async onAgendaCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; items: { title: string; duration: number }[] },
  ) {
    const user = getUser(client);
    const canManage = await this.signalingService.isHostOrCoHost(payload.meetingId, user.sub);
    if (!canManage) return;

    const agendas = await this.agendaService.createAgendas(payload.meetingId, payload.items);
    this.server.to(payload.meetingId).emit('agenda:list', agendas);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('agenda:start')
  async onAgendaStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; agendaId: string },
  ) {
    const user = getUser(client);
    const canManage = await this.signalingService.isHostOrCoHost(payload.meetingId, user.sub);
    if (!canManage) return;

    const activeItem = await this.agendaService.startAgendaItem(payload.meetingId, payload.agendaId);
    this.server.to(payload.meetingId).emit('agenda:active', activeItem);
  }

  // ── Polling ──────────────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('poll:create')
  async onPollCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; question: string; options: string[] },
  ) {
    const user = getUser(client);
    const canCreate = await this.signalingService.isHostOrCoHost(payload.meetingId, user.sub);
    if (!canCreate) return;

    const poll = await this.pollService.createPoll(payload.meetingId, payload.question, payload.options);
    this.server.to(payload.meetingId).emit('poll:created', poll);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('poll:vote')
  async onPollVote(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; pollId: string; optionId: string },
  ) {
    const user = getUser(client);
    await this.pollService.vote(user.sub, payload.pollId, payload.optionId);

    const updatedPolls = await this.pollService.getPolls(payload.meetingId);
    this.server.to(payload.meetingId).emit('poll:updated', updatedPolls);
  }

  // ── Reactions ────────────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('reaction:send')
  async onReactionSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; type: string; anonymous: boolean },
  ) {
    const user = getUser(client);
    await this.reactionService.sendReaction(
      payload.meetingId,
      payload.type,
      payload.anonymous ? undefined : user.sub,
    );

    const aggregated = await this.reactionService.getAggregatedReactions(payload.meetingId);
    this.server.to(payload.meetingId).emit('reaction:aggregated', aggregated);
  }

  // ── Kick participant (HOST only) ──────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('meeting:kick')
  async onKick(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: KickPayload,
  ) {
    const user = getUser(client);
    const canKick = await this.signalingService.isHostOrCoHost(payload.meetingId, user.sub);
    if (!canKick) {
      client.emit('error', { message: 'Only host/co-host can kick participants' });
      return;
    }

    const target = await this.signalingService.getParticipantBySocketId(
      payload.meetingId,
      payload.targetSocketId,
    );
    if (!target) {
      client.emit('error', { message: 'Participant not found' });
      return;
    }
    const isTargetHost = await this.signalingService.isHost(payload.meetingId, target.userId);
    if (isTargetHost) {
      client.emit('error', { message: 'Host cannot be kicked' });
      return;
    }

    const participant = await this.signalingService.kickParticipant(
      payload.meetingId,
      payload.targetSocketId,
    );

    if (!participant) return;

    const targetSocket =
      (this.server as any).sockets?.get?.(payload.targetSocketId) ??
      (this.server as any).sockets?.sockets?.get?.(payload.targetSocketId);
    this.server.to(payload.targetSocketId).emit('meeting:kicked', { reason: 'Removed by host' });
    this.server.to(payload.meetingId).emit('participant:left', {
      socketId: payload.targetSocketId,
      userId: participant.userId,
      user: participant.user,
    });
    if (targetSocket) targetSocket.disconnect();
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('media:force-mute')
  async onForceMute(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: KickPayload,
  ) {
    const user = getUser(client);
    const canMute = await this.signalingService.isHostOrCoHost(payload.meetingId, user.sub);
    if (!canMute) {
      client.emit('error', { message: 'Only host/co-host can mute participants' });
      return;
    }

    const targetSocket =
      (this.server as any).sockets?.get?.(payload.targetSocketId) ??
      (this.server as any).sockets?.sockets?.get?.(payload.targetSocketId);
    if (!targetSocket) {
      client.emit('error', { message: 'Participant not found' });
      return;
    }

    const targetUserId = (targetSocket.data as SocketData).user?.sub;
    targetSocket.data.audioEnabled = false;
    if (targetUserId) {
      await this.signalingService.toggleMedia(
        payload.meetingId,
        targetUserId,
        'audio',
        false,
      );
    }
    this.server.to(payload.targetSocketId).emit('media:force-mute', {
      meetingId: payload.meetingId,
    });
    this.server.to(payload.meetingId).emit('media:updated', {
      socketId: payload.targetSocketId,
      userId: (targetSocket.data as SocketData).user?.sub,
      user: (targetSocket.data as SocketData).profile,
      type: 'audio',
      enabled: false,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('media:ask-unmute')
  async onAskUnmute(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AskUnmutePayload,
  ) {
    const user = getUser(client);
    const canAsk = await this.signalingService.isHostOrCoHost(payload.meetingId, user.sub);
    if (!canAsk) {
      client.emit('error', { message: 'Only host/co-host can ask to unmute' });
      return;
    }

    this.server.to(payload.targetSocketId).emit('media:ask-unmute', {
      meetingId: payload.meetingId,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('meeting:make-cohost')
  async onMakeCoHost(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MakeCoHostPayload,
  ) {
    const user = getUser(client);
    const canPromote = await this.signalingService.isHost(payload.meetingId, user.sub);
    if (!canPromote) {
      client.emit('error', { message: 'Only host can assign co-host' });
      return;
    }

    const updated = await this.signalingService.setParticipantRole(
      payload.meetingId,
      payload.targetUserId,
      'CO_HOST',
    );
    const sockets = await this.server.in(payload.meetingId).fetchSockets();
    sockets.forEach((socket) => {
      const socketUserId = (socket.data as SocketData).user?.sub;
      if (socketUserId === payload.targetUserId) {
        socket.data.role = updated.role;
      }
    });

    this.server.to(payload.meetingId).emit('participant:role-updated', {
      userId: payload.targetUserId,
      role: updated.role,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('meeting:remove-cohost')
  async onRemoveCoHost(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RemoveCoHostPayload,
  ) {
    const user = getUser(client);
    const canDemote = await this.signalingService.isHost(payload.meetingId, user.sub);
    if (!canDemote) {
      client.emit('error', { message: 'Only host can remove co-host' });
      return;
    }

    const updated = await this.signalingService.setParticipantRole(
      payload.meetingId,
      payload.targetUserId,
      'PARTICIPANT',
    );
    const sockets = await this.server.in(payload.meetingId).fetchSockets();
    sockets.forEach((socket) => {
      const socketUserId = (socket.data as SocketData).user?.sub;
      if (socketUserId === payload.targetUserId) {
        socket.data.role = updated.role;
      }
    });

    this.server.to(payload.meetingId).emit('participant:role-updated', {
      userId: payload.targetUserId,
      role: updated.role,
    });
  }
}
