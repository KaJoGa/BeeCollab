import { FALLBACK_ICE_SERVERS, WebrtcService } from './webrtc.service';

describe('WebrtcService', () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };
  let service: WebrtcService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new WebrtcService();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.CF_TURN_KEY_ID;
    delete process.env.CF_TURN_API_TOKEN;
  });

  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  const turnResponse = (iceServers: unknown) => ({
    ok: true,
    status: 201,
    json: () => Promise.resolve({ iceServers }),
  });

  it('returns public STUN without calling Cloudflare when TURN is not configured', async () => {
    await expect(service.getIceServers()).resolves.toEqual(FALLBACK_ICE_SERVERS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests credentials from Cloudflare with the bearer token and a ttl', async () => {
    process.env.CF_TURN_KEY_ID = 'key-id';
    process.env.CF_TURN_API_TOKEN = 'secret-token';
    const servers = [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }];
    fetchMock.mockResolvedValue(turnResponse(servers));

    await expect(service.getIceServers()).resolves.toEqual(servers);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(init.body as string)).toEqual({ ttl: 86400 });
  });

  it('wraps a single iceServers object into an array', async () => {
    process.env.CF_TURN_KEY_ID = 'key-id';
    process.env.CF_TURN_API_TOKEN = 'secret-token';
    const one = { urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' };
    fetchMock.mockResolvedValue(turnResponse(one));

    await expect(service.getIceServers()).resolves.toEqual([one]);
  });

  it('caches credentials between calls', async () => {
    process.env.CF_TURN_KEY_ID = 'key-id';
    process.env.CF_TURN_API_TOKEN = 'secret-token';
    fetchMock.mockResolvedValue(turnResponse([{ urls: 'turn:x', username: 'u', credential: 'c' }]));

    await service.getIceServers();
    await service.getIceServers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to STUN when Cloudflare responds with an error', async () => {
    process.env.CF_TURN_KEY_ID = 'key-id';
    process.env.CF_TURN_API_TOKEN = 'secret-token';
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) });

    await expect(service.getIceServers()).resolves.toEqual(FALLBACK_ICE_SERVERS);
  });

  it('falls back to STUN when the request throws', async () => {
    process.env.CF_TURN_KEY_ID = 'key-id';
    process.env.CF_TURN_API_TOKEN = 'secret-token';
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(service.getIceServers()).resolves.toEqual(FALLBACK_ICE_SERVERS);
  });
});
