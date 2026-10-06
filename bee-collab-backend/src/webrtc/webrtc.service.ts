import { Injectable, Logger } from '@nestjs/common';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const CLOUDFLARE_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const CREDENTIAL_TTL_SECONDS = 86400; // Cloudflare allows up to 48 h
const CACHE_MS = (CREDENTIAL_TTL_SECONDS / 2) * 1000; // refresh at half-life
const REQUEST_TIMEOUT_MS = 5000;

/** Public STUN used when TURN is not configured or Cloudflare is unreachable. */
export const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

@Injectable()
export class WebrtcService {
  private readonly logger = new Logger(WebrtcService.name);
  private cache: { servers: IceServer[]; expiresAt: number } | null = null;

  /**
   * ICE servers for the browser. With CF_TURN_KEY_ID + CF_TURN_API_TOKEN set,
   * returns short-lived Cloudflare TURN credentials (cached); otherwise STUN only.
   * The long-lived key never leaves the server.
   */
  async getIceServers(): Promise<IceServer[]> {
    const keyId = process.env.CF_TURN_KEY_ID?.trim();
    const apiToken = process.env.CF_TURN_API_TOKEN?.trim();
    if (!keyId || !apiToken) return FALLBACK_ICE_SERVERS;

    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.servers;

    try {
      const res = await fetch(
        `${CLOUDFLARE_TURN_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`Cloudflare TURN API responded ${res.status}`);

      const json = (await res.json()) as { iceServers?: IceServer | IceServer[] };
      const raw = json.iceServers;
      const servers = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (servers.length === 0) throw new Error('Cloudflare TURN API returned no iceServers');

      this.cache = { servers, expiresAt: Date.now() + CACHE_MS };
      return servers;
    } catch (err) {
      // Never log the token; message only. Fall back so calls still work over STUN.
      this.logger.warn(
        `TURN credential request failed, falling back to STUN: ${err instanceof Error ? err.message : String(err)}`,
      );
      return FALLBACK_ICE_SERVERS;
    }
  }
}
