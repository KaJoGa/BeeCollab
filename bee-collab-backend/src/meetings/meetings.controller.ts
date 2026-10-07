import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto, JoinMeetingDto } from './dto/meeting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

interface AuthRequest extends Request {
  user: { id: string; isGuest?: boolean };
}

/** Guests have a JWT but no User row, so DB-backed actions would fail with a 500 — refuse them clearly instead. */
function assertNotGuest(req: AuthRequest, action: string) {
  if (req.user.isGuest) {
    throw new ForbiddenException(`Guests cannot ${action}. Please sign in.`);
  }
}

@ApiTags('Meetings')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) { }

  /** POST /meetings — Create a new meeting */
  @Post()
  @ApiOperation({ summary: 'Create a new meeting', description: 'Creates a SCHEDULED meeting and auto-assigns the caller as HOST. The meeting transitions to LIVE when the first participant connects via WebSocket.' })
  @ApiResponse({ status: 201, description: 'Meeting created. Returns full meeting object including roomCode.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Guests cannot create meetings.' })
  create(@Req() req: AuthRequest, @Body() dto: CreateMeetingDto) {
    assertNotGuest(req, 'create meetings');
    return this.meetingsService.createMeeting(req.user.id, dto);
  }

  /** GET /meetings — List my meetings */
  @Get()
  @ApiOperation({ summary: 'List all meetings hosted by the authenticated user' })
  @ApiResponse({ status: 200, description: 'Array of meeting objects.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  myMeetings(@Req() req: AuthRequest) {
    return this.meetingsService.getMyMeetings(req.user.id);
  }

  /** GET /meetings/code/:roomCode */
  @Get('code/:roomCode')
  @ApiOperation({ summary: 'Find a meeting by its room code', description: 'Used by the frontend to resolve a room code entered by the user into a meeting ID.' })
  @ApiParam({ name: 'roomCode', example: 'A1B2C3D4', description: '8-character uppercase room code' })
  @ApiResponse({ status: 200, description: 'Meeting details including host and participant list.' })
  @ApiResponse({ status: 404, description: 'No meeting with that room code.' })
  findByRoomCode(@Param('roomCode') roomCode: string) {
    return this.meetingsService.getMeetingByRoomCode(roomCode);
  }

  /** GET /meetings/:meetingId */
  @Get(':meetingId')
  @ApiOperation({ summary: 'Get a single meeting by ID' })
  @ApiParam({ name: 'meetingId', description: 'UUID of the meeting' })
  @ApiResponse({ status: 200, description: 'Meeting details including host, participants, and status.' })
  @ApiResponse({ status: 404, description: 'Meeting not found.' })
  findOne(@Param('meetingId') meetingId: string) {
    return this.meetingsService.getMeetingById(meetingId);
  }

  /** POST /meetings/:meetingId/join */
  @Post(':meetingId/join')
  @ApiOperation({ summary: 'Join a meeting via room code', description: 'Validates the room code and capacity, then upserts the caller as a PARTICIPANT. WebSocket connection follows separately.' })
  @ApiParam({ name: 'meetingId', description: 'UUID of the meeting to join' })
  @ApiResponse({ status: 201, description: 'Joined successfully. Returns meeting + participant record.' })
  @ApiResponse({ status: 400, description: 'Meeting has ended or is full.' })
  @ApiResponse({ status: 403, description: 'Invalid room code, or the caller is a guest (guests join over WebSocket only).' })
  @ApiResponse({ status: 404, description: 'Meeting not found.' })
  join(
    @Req() req: AuthRequest,
    @Param('meetingId') meetingId: string,
    @Body() dto: JoinMeetingDto,
  ) {
    assertNotGuest(req, 'join through this endpoint');
    return this.meetingsService.joinMeeting(req.user.id, meetingId, dto);
  }

  /** GET /meetings/:meetingId/participants */
  @Get(':meetingId/participants')
  @ApiOperation({ summary: 'List active participants in a meeting' })
  @ApiParam({ name: 'meetingId', description: 'UUID of the meeting' })
  @ApiResponse({ status: 200, description: 'Array of active participants (leftAt IS NULL) with user info.' })
  @ApiResponse({ status: 404, description: 'Meeting not found.' })
  participants(@Param('meetingId') meetingId: string) {
    return this.meetingsService.getParticipants(meetingId);
  }

  /** DELETE /meetings/:meetingId — End a meeting (HOST only) */
  @Delete(':meetingId')
  @ApiOperation({ summary: 'End a meeting (HOST only)', description: 'Deletes the meeting and all associated participants and chat messages. Only the host can call this.' })
  @ApiParam({ name: 'meetingId', description: 'UUID of the meeting to end' })
  @ApiResponse({ status: 200, description: 'Meeting ended and removed.' })
  @ApiResponse({ status: 403, description: 'Only the host can end the meeting.' })
  @ApiResponse({ status: 404, description: 'Meeting not found.' })
  end(@Req() req: AuthRequest, @Param('meetingId') meetingId: string) {
    return this.meetingsService.endMeeting(req.user.id, meetingId);
  }
}
