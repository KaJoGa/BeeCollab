import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WebrtcService } from './webrtc.service';

@ApiTags('WebRTC')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('webrtc')
export class WebrtcController {
  constructor(private readonly webrtcService: WebrtcService) {}

  @Get('ice-servers')
  @ApiOperation({
    summary: 'ICE servers (STUN/TURN) for peer connections',
    description:
      'Works for registered users and guests. Returns short-lived TURN credentials when TURN is configured, otherwise public STUN only.',
  })
  @ApiResponse({ status: 200, description: '`{ iceServers: [{ urls, username?, credential? }] }`' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT token.' })
  async iceServers() {
    return { iceServers: await this.webrtcService.getIceServers() };
  }
}
