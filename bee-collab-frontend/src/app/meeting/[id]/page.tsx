'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Hand, Users, MessageSquare,
  Send, X, Subtitles, MonitorUp, MoreVertical, Info, ListChecks, BarChart3, Smile,
  Gauge
} from 'lucide-react';

const getApiBase = () => {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && env.trim()) return env.replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';
  return `http://${window.location.hostname}:3000`;
};

// Unwrap ApiResponse envelope { success, data, ... } → data
const unwrap = <T = any>(json: any): T => json?.data ?? json;

const getWsBase = () => {
  const apiBase = getApiBase();
  if (!apiBase) return '';
  if (apiBase.startsWith('https://')) return apiBase.replace(/^https:/, 'wss:');
  if (apiBase.startsWith('http://')) return apiBase.replace(/^http:/, 'ws:');
  return apiBase;
};

// Used until (or if) the backend's TURN-enabled list can't be fetched.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// STUN + short-lived TURN credentials from the backend (Cloudflare TURN keys stay server-side).
async function fetchIceServers(token: string): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${getApiBase()}/webrtc/ice-servers`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return DEFAULT_ICE_SERVERS;
    const data = unwrap(await res.json());
    return Array.isArray(data?.iceServers) && data.iceServers.length > 0
      ? data.iceServers
      : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

// Format a kbps value as kbps or Mbps
const fmtRate = (kbps: number) =>
  kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`;

type ConnStats = { rttMs: number | null; downKbps: number; upKbps: number; bars: number };

// 4-bar signal-strength indicator coloured by connection quality
function ConnectionBars({ bars }: { bars: number }) {
  const color = bars >= 4 ? '#34a853' : bars === 3 ? '#9ccc65' : bars === 2 ? '#fbbc04' : '#ea4335';
  const heights = [5, 8, 11, 14];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            width: '3px',
            height: `${h}px`,
            borderRadius: '1px',
            background: i < bars ? color : 'rgba(255,255,255,0.3)',
          }}
        />
      ))}
    </div>
  );
}

export default function Meeting() {
  const router = useRouter();
  const params = useParams();
  const meetingId = params.id as string;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isJoining, setIsJoining] = useState(true);
  const [mediaEnabled, setMediaEnabled] = useState({ audio: false, video: false });
  // Audio-only / data-saver mode: stop DOWNLOADING remote video to save bandwidth
  const [audioOnly, setAudioOnly] = useState(false);
  const audioOnlyRef = useRef(false);
  // Live connection quality for the local user (aggregated across all peers)
  const [connStats, setConnStats] = useState<ConnStats>({ rttMs: null, downKbps: 0, upKbps: 0, bars: 0 });
  const statsPrevRef = useRef<{ ts: number; recv: number; sent: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'people' | 'agenda' | 'polls' | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isCoHost, setIsCoHost] = useState(false);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [meetingEndedReason, setMeetingEndedReason] = useState('');
  const [meetingEndType, setMeetingEndType] = useState<'ended' | 'kicked' | 'expired' | 'full'>('ended');
  const [countdown, setCountdown] = useState(30);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream[]>>({});
  const [meetingInfo, setMeetingInfo] = useState<{
    title: string;
    roomCode: string;
    hostName: string;
    hostId: string;
    participantUsers: Record<string, { name: string; avatarUrl?: string | null }>;
  } | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isLeaveMenuOpen, setIsLeaveMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [speakingQueue, setSpeakingQueue] = useState<any[]>([]);
  const [agendas, setAgendas] = useState<any[]>([]);
  const [activeAgenda, setActiveAgenda] = useState<any>(null);
  const [polls, setPolls] = useState<any[]>([]);
  const [reactions, setReactions] = useState<any[]>([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newPollOptions, setNewPollOptions] = useState(['', '']);
  const [newAgendaItems, setNewAgendaItems] = useState([{ title: '', duration: 60 }]);
  const [speakingParticipants, setSpeakingParticipants] = useState<Record<string, boolean>>({});
  const [showAutoplayOverlay, setShowAutoplayOverlay] = useState(false);
  const [isDeviceSettingsOpen, setIsDeviceSettingsOpen] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [openParticipantMenuUserId, setOpenParticipantMenuUserId] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>('');
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string>('');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaEnabledRef = useRef(mediaEnabled);
  const pendingMediaSyncRef = useRef(false);
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const screenStreamRef = useRef<MediaStream | null>(null);
  // Always points to the latest toggleMedia — avoids stale closure in WS listeners
  const toggleMediaRef = useRef<(type: 'audio' | 'video') => Promise<void>>(() => Promise.resolve());
  type PeerState = {
    pc: RTCPeerConnection;
    makingOffer: boolean;
    ignoreOffer: boolean;
    isSettingRemoteAnswerPending: boolean;
    polite: boolean;
    pendingIce: RTCIceCandidateInit[];
    statsIntervalId?: number;
  };
  const peerStateRef = useRef<Record<string, PeerState>>({});
  const remoteStreamsRef = useRef<Record<string, MediaStream[]>>({});

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    mediaEnabledRef.current = mediaEnabled;
  }, [mediaEnabled]);

  useEffect(() => {
    if (!openParticipantMenuUserId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const isMenu = target.closest('[data-participant-menu="true"]');
      const isButton = target.closest('[data-participant-menu-button="true"]');
      if (!isMenu && !isButton) {
        setOpenParticipantMenuUserId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openParticipantMenuUserId]);

  useEffect(() => {
    if (!isMoreMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const isMenu = target.closest('[data-kebab-menu="true"]');
      const isButton = target.closest('[data-kebab-menu-button="true"]');
      if (!isMenu && !isButton) {
        setIsMoreMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreMenuOpen]);

  useEffect(() => {
    if (!meetingEnded || meetingEndType === 'kicked') return;

    const timer = setInterval(() => {
      // Only compute the next value here — never navigate inside a state updater
      // (that runs during render and triggers a Router update during render).
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [meetingEnded, meetingEndType]);

  // Navigate home once the countdown reaches zero — kept separate from the
  // countdown updater so router.push is never called during render.
  useEffect(() => {
    if (meetingEnded && meetingEndType !== 'kicked' && countdown <= 0) {
      router.push('/');
    }
  }, [meetingEnded, meetingEndType, countdown, router]);
  useEffect(() => {
    if (activeTab === 'chat' && chatContainerRef.current) {
      const container = chatContainerRef.current;
      // Scroll to bottom immediately when opening chat or when new messages arrive
      // unless the user is scrolling up (only for message updates)
      container.scrollTop = container.scrollHeight;
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'chat' && chatContainerRef.current) {
      const container = chatContainerRef.current;
      const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 150;
      if (isAtBottom) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages]);

  useEffect(() => {
    if (!socket?.id) return;
    const me = participants.find((p) => p.socketId === socket.id);
    setIsCoHost(me?.role === 'CO_HOST');
  }, [participants, socket?.id]);

  useEffect(() => {
    if (!isDeviceSettingsOpen) return;
    let isActive = true;

    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!isActive) return;

        const audios = devices.filter((d) => d.kind === 'audioinput');
        const videos = devices.filter((d) => d.kind === 'videoinput');
        setAudioDevices(audios);
        setVideoDevices(videos);

        if (!selectedAudioDeviceId && audios[0]) {
          setSelectedAudioDeviceId(audios[0].deviceId);
        }
        if (!selectedVideoDeviceId && videos[0]) {
          setSelectedVideoDeviceId(videos[0].deviceId);
        }
      } catch (e) {
        console.error('Failed to load media devices', e);
      }
    };

    loadDevices();
    return () => {
      isActive = false;
    };
  }, [isDeviceSettingsOpen, selectedAudioDeviceId, selectedVideoDeviceId]);

  // Real-time Voice Activity Detection (VAD)
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const analysers: Record<string, { interval: any; node: AnalyserNode }> = {};

    const setupMonitor = (id: string, stream: MediaStream) => {
      if (analysers[id] || stream.getAudioTracks().length === 0) return;
      try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const interval = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const avg = sum / dataArray.length;
          const isSpeaking = avg > 15; // Volume threshold
          setSpeakingParticipants(prev => {
            if (prev[id] === isSpeaking) return prev;
            // Emit to others if local
            if (id === 'local' && socket) {
              socket.emit('media:speaking', { meetingId, speaking: isSpeaking });
            }
            return { ...prev, [id]: isSpeaking };
          });
        }, 150);

        analysers[id] = { interval, node: analyser };
      } catch (e) {
        console.warn('VAD Setup Error:', id, e);
      }
    };

    // Monitor Local Only and emit to socket
    if (localStream && mediaEnabled.audio) {
      setupMonitor('local', localStream);
    } else {
      setSpeakingParticipants(prev => {
        if (prev['local'] === false) return prev;
        if (socket) socket.emit('media:speaking', { meetingId, speaking: false });
        return { ...prev, local: false };
      });
    }

    // Remote monitoring removed - now handled via sockets!

    return () => {
      Object.values(analysers).forEach(a => clearInterval(a.interval));
      audioContext.close().catch(() => { });
    };
  }, [localStream, mediaEnabled.audio, socket, meetingId]);

  const playSound = (type: 'join' | 'leave' | 'self-join') => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'join') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now); // A4
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.2); // A5
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'leave') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, now); // E5
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.2); // E4
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'self-join') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.15); // E5
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.2);
        gain.gain.linearRampToValueAtTime(0, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      }

      setTimeout(() => ctx.close(), 1000);
    } catch (e) {
      console.warn('Failed to play sound effect:', e);
    }
  };

  const mobileStyles = `
    @media (max-width: 768px) {
      .video-grid-container {
        padding: 0.5rem !important;
        gap: 0.5rem !important;
      }
      .video-grid-inner {
        grid-template-columns: 1fr !important;
        grid-template-rows: auto !important;
        max-width: 100% !important;
        gap: 0.75rem !important;
      }
      .participant-card {
        flex: 1 1 100% !important;
        max-width: 100% !important;
        max-height: 30vh !important;
      }
      .sidebar-container.sidebar-chat {
        position: fixed !important;
        inset: 0 !important;
        width: auto !important;
        height: auto !important;
        max-width: none !important;
        border-radius: 0 !important;
        z-index: 200 !important;
      }
      .sidebar-container.sidebar-people {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        transform: translate(-50%, -50%) !important;
        width: calc(100% - 2rem) !important;
        max-width: 480px !important;
        height: 70vh !important;
        max-height: calc(100vh - 8rem) !important;
        border-radius: 20px !important;
        border-left: none !important;
        z-index: 100 !important;
      }
      .bottom-bar {
        padding: 0 0.5rem !important;
        height: 80px !important;
        position: relative !important;
        z-index: 110 !important;
      }
      .bottom-bar-info {
        display: none !important;
      }
      .bottom-bar-actions {
        display: none !important;
      }
      .top-bar {
        display: flex !important;
      }
      .screen-share-btn {
        display: none !important;
      }
      .mobile-action-btn {
        display: flex !important;
      }
      .mobile-menu-item {
        display: block !important;
      }
      .controls-container {
        gap: 0.4rem !important;
        flex: 1 !important;
        justify-content: center !important;
      }
      .control-btn {
        width: 38px !important;
        height: 38px !important;
      }
      .control-btn svg {
        width: 18px !important;
        height: 18px !important;
      }
      .name-badge-container {
        bottom: 0.5rem !important;
        left: 0.5rem !important;
      }
      .name-badge {
        font-size: 0.65rem !important;
        padding: 0.15rem 0.5rem !important;
        border-radius: 8px !important;
        max-width: 80px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .meeting-ended-countdown {
        top: 1rem !important;
        left: 1rem !important;
        gap: 8px !important;
      }
      .meeting-ended-countdown span {
        display: none !important;
      }
      .meeting-ended-logo {
        margin-bottom: 2rem !important;
      }
      .meeting-ended-logo svg {
        width: 28px !important;
        height: 28px !important;
      }
      .meeting-ended-logo span {
        font-size: 1.25rem !important;
      }
      .meeting-ended-title {
        font-size: 1.5rem !important;
        line-height: 1.3 !important;
        margin: 0 auto 2rem !important;
      }
    }
  `;

  useEffect(() => {
    return () => {
      Object.values(peerStateRef.current).forEach((state) => state.pc.close());
      peerStateRef.current = {};
      remoteStreamsRef.current = {};
      setRemoteStreams({});
    };
  }, []);

  const addRemoteStream = (socketId: string, stream: MediaStream) => {
    const existing = remoteStreamsRef.current[socketId] || [];
    // Ensure we have the latest reference and trigger re-render
    const otherStreams = existing.filter(s => s.id !== stream.id);
    const updated = [...otherStreams, stream];
    remoteStreamsRef.current = { ...remoteStreamsRef.current, [socketId]: updated };
    setRemoteStreams({ ...remoteStreamsRef.current });
  };

  const removeSpecificStream = (socketId: string, streamId: string) => {
    const existing = remoteStreamsRef.current[socketId] || [];
    const updated = existing.filter(s => s.id !== streamId);
    remoteStreamsRef.current = { ...remoteStreamsRef.current, [socketId]: updated };
    setRemoteStreams(remoteStreamsRef.current);
  };

  const removeAllRemoteStreams = (socketId: string) => {
    const nextStreams = { ...remoteStreamsRef.current };
    delete nextStreams[socketId];
    remoteStreamsRef.current = nextStreams;
    setRemoteStreams(nextStreams);
  };

  // Target per-stream video bitrate. Shrinks as the mesh grows, because in a
  // full mesh each person's upload = (peers) × bitrate. Keeping total upload
  // bounded is what prevents lag as the call fills up.
  const getTargetVideoKbps = () => {
    const peers = Object.keys(peerStateRef.current).length; // other participants
    if (peers <= 1) return 1200; // 1:1 — full quality
    if (peers <= 3) return 600;  // up to ~4 people
    return 300;                  // 5+ — keep the call alive
  };

  // Apply encode caps to a peer connection's senders:
  //  - video: hard max bitrate + framerate
  //  - audio: Opus DTX (stop sending during silence) + modest cap
  const applyBandwidthLimits = async (pc: RTCPeerConnection) => {
    for (const sender of pc.getSenders()) {
      if (!sender.track) continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      if (sender.track.kind === 'video') {
        params.encodings[0].maxBitrate = getTargetVideoKbps() * 1000;
        params.encodings[0].maxFramerate = 24;
      } else if (sender.track.kind === 'audio') {
        params.encodings[0].maxBitrate = 32 * 1000; // 32 kbps is plenty for speech
        (params.encodings[0] as RTCRtpEncodingParameters & { dtx?: string }).dtx = 'enabled';
      }
      try {
        await sender.setParameters(params);
      } catch {
        /* some browsers reject mid-negotiation — re-applied on connect */
      }
    }
  };

  // When the participant count changes, re-apply caps to every peer so the
  // per-stream bitrate scales down as the call fills (and back up as it empties).
  useEffect(() => {
    Object.values(peerStateRef.current).forEach((state) => {
      void applyBandwidthLimits(state.pc);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants.length]);

  useEffect(() => {
    audioOnlyRef.current = audioOnly;
  }, [audioOnly]);

  // Poll WebRTC stats for the local user: ping (RTT) + up/download bitrate,
  // aggregated across every peer connection (mesh = we send/recv to each peer).
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;

    const poll = async () => {
      const pcs = Object.values(peerStateRef.current);
      if (pcs.length === 0) {
        setConnStats({ rttMs: null, downKbps: 0, upKbps: 0, bars: 0 });
        statsPrevRef.current = null;
        return;
      }

      let totalRecv = 0;
      let totalSent = 0;
      const rtts: number[] = [];

      for (const { pc } of pcs) {
        try {
          const stats = await pc.getStats();
          let pairRecv = 0;
          let pairSent = 0;
          let bestPair: any = null;

          stats.forEach((r: any) => {
            // Bytes from RTP reports — these reliably track media throughput
            if (r.type === 'inbound-rtp') totalRecv += r.bytesReceived || 0;
            else if (r.type === 'outbound-rtp') totalSent += r.bytesSent || 0;
            // RTT + transport-level bytes from the selected ICE candidate-pair
            else if (r.type === 'candidate-pair' && r.state === 'succeeded') {
              if (r.nominated || r.selected || !bestPair) bestPair = r;
            }
          });

          if (bestPair) {
            if (bestPair.currentRoundTripTime != null) rtts.push(bestPair.currentRoundTripTime);
            pairRecv = bestPair.bytesReceived || 0;
            pairSent = bestPair.bytesSent || 0;
          }
          // Fallback: if RTP byte counters were empty (e.g. no media yet),
          // use the candidate-pair transport bytes so the meter still moves.
          if (totalRecv === 0) totalRecv += pairRecv;
          if (totalSent === 0) totalSent += pairSent;
        } catch {
          /* ignore a peer that failed to report */
        }
      }
      if (cancelled) return;

      const now = Date.now();
      let downKbps = 0;
      let upKbps = 0;
      const prev = statsPrevRef.current;
      if (prev) {
        const dt = (now - prev.ts) / 1000;
        if (dt > 0) {
          downKbps = Math.max(0, ((totalRecv - prev.recv) * 8) / dt / 1000);
          upKbps = Math.max(0, ((totalSent - prev.sent) * 8) / dt / 1000);
        }
      }
      statsPrevRef.current = { ts: now, recv: totalRecv, sent: totalSent };

      const rttMs = rtts.length
        ? Math.round((rtts.reduce((a, b) => a + b, 0) / rtts.length) * 1000)
        : null;

      let bars: number;
      if (rttMs == null) bars = 3; // connected but RTT not reported yet
      else if (rttMs < 100) bars = 4;
      else if (rttMs < 250) bars = 3;
      else if (rttMs < 450) bars = 2;
      else bars = 1;

      setConnStats({ rttMs, downKbps, upKbps, bars });
    };

    void poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isConnected]);

  // Renegotiate a peer's video transceivers so the remote stops (or resumes)
  // sending video. This actually stops the DOWNLOAD — not just the rendering.
  const applyReceiveVideoPreference = (pc: RTCPeerConnection) => {
    const wantReceive = !audioOnlyRef.current;
    pc.getTransceivers().forEach((t) => {
      if (t.currentDirection === 'stopped') return;
      const isVideo =
        t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video';
      if (!isVideo) return;

      const sendingVideo = t.sender?.track?.kind === 'video';
      const desired: RTCRtpTransceiverDirection = wantReceive
        ? (sendingVideo ? 'sendrecv' : 'recvonly')
        : (sendingVideo ? 'sendonly' : 'inactive');

      if (t.direction !== desired) {
        try {
          t.direction = desired; // triggers negotiationneeded → renegotiation
        } catch {
          /* transceiver may be in a transient state — ignored */
        }
      }
    });
  };

  // Toggle audio-only mode and re-apply to every existing peer.
  const toggleAudioOnly = () => {
    const next = !audioOnlyRef.current;
    audioOnlyRef.current = next;
    setAudioOnly(next);
    Object.values(peerStateRef.current).forEach((state) => {
      applyReceiveVideoPreference(state.pc);
    });
  };

  const createPeerConnection = (targetId: string, activeSocket: Socket) => {
    const existing = peerStateRef.current[targetId];
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
    });

    const state: PeerState = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      polite: (activeSocket.id || '').localeCompare(targetId) < 0,
      pendingIce: [],
    };

    peerStateRef.current[targetId] = state;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        activeSocket.emit('webrtc:ice-candidate', {
          to: targetId,
          from: activeSocket.id,
          candidate: event.candidate,
        });
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        activeSocket.emit('webrtc:offer', {
          to: targetId,
          from: activeSocket.id,
          sdp: pc.localDescription,
        });
      } catch (err) {
        console.error(err);
        // If negotiation failed (e.g. due to collision with incoming offer),
        // retry once when the signaling state returns to stable.
        if (pc.signalingState !== 'closed') {
          const retryOnStable = () => {
            if (pc.signalingState === 'stable') {
              pc.removeEventListener('signalingstatechange', retryOnStable);
              // Re-trigger negotiation — dispatchEvent won't call onnegotiationneeded
              // property handler, so call it directly.
              pc.onnegotiationneeded?.(new Event('negotiationneeded'));
            }
          };
          pc.addEventListener('signalingstatechange', retryOnStable);
        }
      } finally {
        state.makingOffer = false;
      }
    };

    pc.ontrack = (event) => {
      const track = event.track;
      console.log('[webrtc:ontrack]', {
        peer: targetId,
        kind: track.kind,
        id: track.id,
        readyState: track.readyState,
      });
      const trackLabel = track.label?.toLowerCase?.() || '';
      const trackSettings = track.getSettings?.();
      const isScreenTrack =
        track.kind === 'video' &&
        Boolean(
          (trackSettings as MediaTrackSettings | undefined)?.displaySurface ||
          trackLabel.includes('screen') ||
          trackLabel.includes('window') ||
          trackLabel.includes('tab'),
        );

      const streamsForPeer = remoteStreamsRef.current[targetId] || [];
      const slotIndex = isScreenTrack ? 1 : 0;
      const combined = streamsForPeer[slotIndex] || new MediaStream();

      if (!combined.getTracks().some((t) => t.id === track.id)) {
        combined.addTrack(track);
      }

      track.onended = () => {
        try {
          combined.removeTrack(track);
        } catch (e) {
          // Ignore removal errors if track is already detached.
        }
        if (combined.getTracks().length === 0) {
          removeSpecificStream(targetId, combined.id);
        }
      };

      const nextStreams = [...streamsForPeer];
      nextStreams[slotIndex] = combined;
      remoteStreamsRef.current = { ...remoteStreamsRef.current, [targetId]: nextStreams };
      setRemoteStreams({ ...remoteStreamsRef.current });
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${targetId}: ${pc.connectionState}`);
      if (pc.connectionState === 'connected' && !state.statsIntervalId) {
        state.statsIntervalId = window.setInterval(async () => {
          try {
            const stats = await pc.getStats();
            stats.forEach((report) => {
              if (report.type === 'inbound-rtp' && !report.isRemote) {
                console.log('[webrtc:inbound-rtp]', {
                  peer: targetId,
                  kind: report.kind,
                  bytesReceived: report.bytesReceived,
                  packetsLost: report.packetsLost,
                  jitter: report.jitter,
                });
              }
            });
          } catch (e) {
            console.warn('[webrtc:getStats] failed', targetId, e);
          }
        }, 3000);
      }
      if (['failed', 'closed'].includes(pc!.connectionState)) {
        if (state.statsIntervalId) {
          window.clearInterval(state.statsIntervalId);
          state.statsIntervalId = undefined;
        }
        pc!.close();
        delete peerStateRef.current[targetId];
        removeAllRemoteStreams(targetId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${targetId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
      }
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        // Re-apply caps once connected (some browsers ignore setParameters pre-connect)
        void applyBandwidthLimits(pc);
        // Enforce audio-only on freshly-negotiated peers
        if (audioOnlyRef.current) applyReceiveVideoPreference(pc);
      }
    };

    // Add tracks AFTER attaching all event listeners so negotiationneeded fires reliably!
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }
    const screenStream = screenStreamRef.current;
    if (screenStream) {
      screenStream.getTracks().forEach((track) => pc.addTrack(track, screenStream));
    }

    // Cap bitrate/framerate on the freshly-added senders
    void applyBandwidthLimits(pc);

    return state;
  };

  const updatePeerConnectionsTracks = async (
    stream: MediaStream | null,
    activeSocket: Socket | null,
  ) => {
    const audioTrack = stream?.getAudioTracks()[0] ?? null;
    const videoTrack = stream?.getVideoTracks()[0] ?? null;

    const pcs = Object.entries(peerStateRef.current);

    pcs.forEach(([, state]) => {
      const pc = state.pc;
      const senders = pc.getSenders();
      const screenTrack = screenStreamRef.current?.getVideoTracks()[0];

      // 1) First, try to find senders that already have an active track.
      let audioSender = senders.find(s => s.track?.kind === 'audio');
      let videoSender = senders.find(s => s.track?.kind === 'video' && s.track !== screenTrack);

      // 2) If not found, check for transceivers that WERE previously sending
      //    (direction=sendrecv) but now have null tracks (cam/mic toggled off).
      //    Safe to replaceTrack on these — direction is already sendrecv.
      //    Skip recvonly transceivers (from remote offer) — those need addTrack
      //    to flip direction and trigger renegotiation.
      if (!audioSender) {
        const t = pc.getTransceivers().find(t =>
          t.receiver.track.kind === 'audio' &&
          t.sender.track === null &&
          (t.direction === 'sendrecv' || t.direction === 'sendonly'),
        );
        if (t) audioSender = t.sender;
      }
      if (!videoSender) {
        const t = pc.getTransceivers().find(t =>
          t.receiver.track.kind === 'video' &&
          t.sender.track === null &&
          t.sender !== senders.find(s => s.track === screenTrack) &&
          (t.direction === 'sendrecv' || t.direction === 'sendonly'),
        );
        if (t) videoSender = t.sender;
      }

      if (audioSender) {
        audioSender.replaceTrack(audioTrack);
      } else if (audioTrack && stream) {
        pc.addTrack(audioTrack, stream);
      }

      if (videoSender) {
        videoSender.replaceTrack(videoTrack);
      } else if (videoTrack && stream) {
        pc.addTrack(videoTrack, stream);
      }

      // addTrack/replaceTrack can reset direction to sendrecv — re-assert audio-only
      if (audioOnlyRef.current) applyReceiveVideoPreference(pc);
    });

    if (!activeSocket) return;
  };

  const bindVideo = (stream: MediaStream | null) => (el: HTMLVideoElement | null) => {
    if (el && stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      // Only attempt to play if we haven't already explicitly tried in this render pass 
      // or if it's paused.
      if (el.paused) {
        const playPromise = el.play();
        if (playPromise !== undefined) {
          playPromise.catch(err => {
            if (err.name === 'NotAllowedError') {
              setShowAutoplayOverlay(true);
            }
          });
        }
      }
    } else if (el && !stream) {
      el.srcObject = null;
    }
  };

  const resumeMediaPlayback = async () => {
    const videos = Array.from(document.querySelectorAll('video'));
    let anyFailed = false;
    await Promise.all(
      videos.map(async (video) => {
        try {
          await video.play();
        } catch (e) {
          anyFailed = true;
        }
      }),
    );
    if (!anyFailed) {
      setShowAutoplayOverlay(false);
    }
  };

  const stopScreenShare = async () => {
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
    if (screenTrack) {
      Object.values(peerStateRef.current).forEach((state) => {
        const sender = state.pc.getSenders().find(s => s.track === screenTrack);
        if (sender) {
          try { state.pc.removeTrack(sender); } catch (e) { }
        }
      });
      screenTrack.stop();
    }
    screenStreamRef.current = null;
    setIsScreenSharing(false);
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }

    const isAnyoneElseSharingScreen = Object.values(remoteStreams).some(streams => streams.length > 1);
    if (isAnyoneElseSharingScreen) {
      alert('Someone else is presenting. You cannot share screen at this time.');
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert('Browser does not support screen sharing.');
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      const screenTracks = screenStream.getTracks();
      if (screenTracks.length === 0) return;

      screenStreamRef.current = screenStream;
      setIsScreenSharing(true);

      const mainVideoTrack = screenStream.getVideoTracks()[0];
      if (mainVideoTrack) {
        mainVideoTrack.addEventListener('ended', () => {
          stopScreenShare();
        });
      }

      Object.values(peerStateRef.current).forEach((state) => {
        screenTracks.forEach(track => {
          state.pc.addTrack(track, screenStream);
        });
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [localStream]);

  useEffect(() => {
    if (!meetingId) return;

    const token = localStorage.getItem('token');
    if (!token) {
      // Preserve the meeting URL so guest/login flow can redirect back
      router.push(`/login?redirect=/meeting/${meetingId}`);
      return;
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meetingId);
    if (!isUuid) {
      const resolveRoomCode = async () => {
        try {
          const res = await fetch(`${getApiBase()}/meetings/code/${meetingId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = unwrap(await res.json());
            router.replace(`/meeting/${data.id}`);
          }
        } catch (e) {
          console.error(e);
        }
      };

      resolveRoomCode();
      return;
    }

    const newSocket = io(`${getWsBase()}/meetings`, {
      auth: { token },
      transports: ['websocket'],
    });

    newSocket.on('connect', async () => {
      setIsConnected(true);
      // Fetch ICE servers now that the backend is known to be awake and before any
      // peer connection is created (peers are created after meeting:join).
      iceServersRef.current = await fetchIceServers(token);
      const initialMedia = mediaEnabledRef.current;
      // Send initial media state (sync with current local state)
      newSocket.emit('meeting:join', {
        meetingId,
        audioEnabled: initialMedia.audio,
        videoEnabled: initialMedia.video
      });
      playSound('self-join');
    });

    newSocket.on('meeting:state', async (data) => {
      setParticipants(data.participants);

      if (!Array.isArray(data.participants)) return;
      const others = data.participants
        .map((p: any) => p.socketId)
        .filter((id: string) => id && id !== newSocket.id);

      for (const targetId of others) {
        createPeerConnection(targetId, newSocket);
      }
    });

    newSocket.on('participant:joined', async (data) => {
      setParticipants(prev => {
        if (prev.find(p => p.socketId === data.socketId)) return prev;
        return [...prev, data];
      });

      refreshMeetingInfo();

      if (!data?.socketId || data.socketId === newSocket.id) return;
      playSound('join');
      createPeerConnection(data.socketId, newSocket);
    });

    newSocket.on('participant:left', (data) => {
      setParticipants(prev => prev.filter(p => p.socketId !== data.socketId));
      playSound('leave');
      if (!data?.socketId) return;

      const state = peerStateRef.current[data.socketId];
      if (state) {
        state.pc.close();
        delete peerStateRef.current[data.socketId];
      }
      removeAllRemoteStreams(data.socketId);
      refreshMeetingInfo();
    });
    newSocket.on('webrtc:offer', async (payload) => {
      if (!payload?.from || payload.from === newSocket.id || !payload.sdp) return;

      const targetId = payload.from;
      const state = createPeerConnection(targetId, newSocket);
      const pc = state.pc;
      const description = new RTCSessionDescription(payload.sdp);

      const offerCollision =
        description.type === 'offer' &&
        (state.makingOffer || pc.signalingState !== 'stable');

      state.ignoreOffer = !state.polite && offerCollision;
      if (state.ignoreOffer) return;

      try {
        if (offerCollision) {
          // Only rollback if we actually have a pending local offer.
          // makingOffer can be true while signalingState is still 'stable'
          // (createOffer started but setLocalDescription hasn't been called yet).
          if (pc.signalingState === 'have-local-offer') {
            await pc.setLocalDescription({ type: 'rollback' });
          }
          await pc.setRemoteDescription(description);
        } else {
          await pc.setRemoteDescription(description);
        }

        if (description.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          newSocket.emit('webrtc:answer', {
            to: targetId,
            from: newSocket.id,
            sdp: pc.localDescription,
          });
        }

        if (state.pendingIce.length > 0) {
          const pending = [...state.pendingIce];
          state.pendingIce = [];
          await Promise.all(
            pending.map((candidate) => pc.addIceCandidate(candidate)),
          );
        }
      } catch (err) {
        console.error('[webrtc:offer] Failed to handle offer', err);
      }
    });

    newSocket.on('webrtc:answer', async (payload) => {
      if (!payload?.from) return;
      const state = peerStateRef.current[payload.from];
      if (!state) return;

      const pc = state.pc;
      if (pc.signalingState !== 'have-local-offer') return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

        if (state.pendingIce.length > 0) {
          const pending = [...state.pendingIce];
          state.pendingIce = [];
          await Promise.all(
            pending.map((candidate) =>
              pc.addIceCandidate(candidate).catch((e) =>
                console.warn('[webrtc:ice] Failed to add queued candidate', e),
              ),
            ),
          );
        }
      } catch (err) {
        console.error('[webrtc:answer] Failed to handle answer', err);
      }
    });

    newSocket.on('webrtc:ice-candidate', async (payload) => {
      if (!payload?.from || !payload?.candidate) return;
      const state = peerStateRef.current[payload.from];
      if (!state) return;

      const pc = state.pc;
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) {
          console.error(e);
        }
        return;
      }

      state.pendingIce.push(payload.candidate);
    });

    newSocket.on('chat:message', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    newSocket.on('chat:history', (history) => {
      setMessages(history);
    });

    newSocket.on('meeting:ended', (data) => {
      const reason = data?.reason || 'The meeting has been ended by the host.';
      setMeetingEndedReason(reason);
      if (reason.toLowerCase().includes('durasi') || reason.toLowerCase().includes('habis') || reason.toLowerCase().includes('time')) {
        setMeetingEndType('expired');
      } else {
        setMeetingEndType('ended');
      }
      setMeetingEnded(true);
    });

    newSocket.on('meeting:kicked', (payload) => {
      const reason = payload?.reason || 'You have been removed from the meeting.';
      setMeetingEndedReason(reason);
      setMeetingEndType('kicked');
      setMeetingEnded(true);
    });

    newSocket.on('meeting:full', (payload) => {
      setMeetingEndedReason(payload?.message || 'This meeting is full.');
      setMeetingEndType('full');
      setMeetingEnded(true);
    });

    newSocket.on('media:force-mute', () => {
      if (mediaEnabledRef.current.audio) {
        toggleMediaRef.current('audio');
      }
    });

    newSocket.on('media:ask-unmute', () => {
      const agree = window.confirm('The host is asking you to unmute. Unmute now?');
      if (agree && !mediaEnabledRef.current.audio) {
        // Use ref so we always call the latest toggleMedia, not the stale closure
        toggleMediaRef.current('audio');
      }
    });

    newSocket.on('queue:updated', (payload) => {
      setSpeakingQueue(payload);
    });

    newSocket.on('agenda:list', (payload) => {
      setAgendas(payload);
      const active = payload.find((a: any) => a.isActive);
      if (active) setActiveAgenda(active);
    });

    newSocket.on('agenda:active', (payload) => {
      setActiveAgenda(payload);
      setAgendas((prev) => prev.map(a => ({
        ...a,
        isActive: a.id === payload.id
      })));
    });

    newSocket.on('poll:list', (payload) => {
      setPolls(payload);
    });

    newSocket.on('poll:created', (payload) => {
      setPolls((prev) => [payload, ...prev]);
    });

    newSocket.on('poll:updated', (payload) => {
      setPolls(payload);
    });

    newSocket.on('reaction:aggregated', (payload) => {
      setReactions(payload);
    });

    newSocket.on('media:updated', (payload) => {
      if (!payload?.socketId) return;
      setParticipants((prev) => prev.map(p => {
        if (p.socketId === payload.socketId) {
          return {
            ...p,
            [payload.type === 'video' ? 'videoEnabled' : 'audioEnabled']: payload.enabled
          };
        }
        return p;
      }));
    });

    newSocket.on('participant:role-updated', (payload) => {
      if (!payload?.userId) return;
      setParticipants((prev) => prev.map((p) => {
        if (p.userId === payload.userId) {
          return { ...p, role: payload.role };
        }
        return p;
      }));
    });

    newSocket.on('media:speaking', (payload) => {
      if (!payload?.socketId) return;
      setSpeakingParticipants(prev => ({
        ...prev,
        [payload.socketId]: payload.speaking
      }));
    });

    newSocket.on('error', (err) => {
      console.error('Socket error:', err);
    });

    setSocket(newSocket);

    // Fetch meeting details to know if we are the host and resolve names
    async function refreshMeetingInfo() {
      try {
        const res = await fetch(`${getApiBase()}/meetings/${meetingId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = unwrap(await res.json());
          const participantUsers = (data.participants || []).reduce(
            (acc: Record<string, { name: string; avatarUrl?: string | null }>, participant: any) => {
              if (participant?.user?.id) {
                acc[participant.user.id] = {
                  name: participant.user.name || 'User',
                  avatarUrl: participant.user.avatarUrl ?? null,
                };
              }
              return acc;
            },
            {});

          if (data.host?.id) {
            participantUsers[data.host.id] = {
              name: data.host.name || 'Host',
              avatarUrl: data.host.avatarUrl ?? null,
            };
          }

          setMeetingInfo({
            title: data.title || 'Meeting',
            roomCode: data.roomCode || meetingId,
            hostName: data.host?.name || 'Host',
            hostId: data.host?.id || '',
            participantUsers,
          });
          // Resolve current user ID — guests use the JWT sub directly
          const guestName = localStorage.getItem('guestName');
          if (guestName) {
            // Guest: decode sub from JWT without a DB call
            // JWT uses base64url (no padding, - and _ instead of + and /)
            // so we must normalise before passing to atob.
            try {
              const b64 = (token ?? '').split('.')[1]
                .replace(/-/g, '+').replace(/_/g, '/');
              const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
              const jwtPayload = JSON.parse(atob(padded));
              setCurrentUserId(jwtPayload.sub ?? null);
            } catch { /* ignore */ }
            setIsHost(false); // guests can never be hosts
          } else {
            const meRes = await fetch(`${getApiBase()}/users/me`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (meRes.ok) {
              const meData = unwrap(await meRes.json());
              setCurrentUserId(meData.id);
              setIsHost(data.hostId === meData.id);
            }
          }

          // Once everything is loaded, stop joining state
          setTimeout(() => {
            setIsJoining(false);
          }, 800);
        } else if (res.status === 404) {
          router.push('/');
        }
      } catch (e) {
        console.error(e);
        setIsJoining(false);
      }
    }
    refreshMeetingInfo();

    return () => {
      newSocket.disconnect();
    };
  }, [meetingId, router]);

  const getAudioConstraint = () => {
    // Echo cancellation + noise suppression also reduce bitrate on Opus
    const base: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (selectedAudioDeviceId) base.deviceId = { exact: selectedAudioDeviceId };
    return base;
  };

  const getVideoConstraint = () => {
    // Cap capture at 640×360 / 24fps — far less bandwidth than the 720p default,
    // which is the single biggest win for a P2P mesh.
    const base: MediaTrackConstraints = {
      width: { ideal: 640, max: 1280 },
      height: { ideal: 360, max: 720 },
      frameRate: { ideal: 24, max: 30 },
    };
    if (selectedVideoDeviceId) base.deviceId = { exact: selectedVideoDeviceId };
    return base;
  };

  const applyDeviceSelection = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;

      const nextStream = localStream ? new MediaStream(localStream.getTracks()) : new MediaStream();

      if (mediaEnabledRef.current.audio) {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraint(),
          video: false,
        });
        const newAudioTrack = audioStream.getAudioTracks()[0];
        if (newAudioTrack) {
          nextStream.getAudioTracks().forEach((t) => {
            t.stop();
            nextStream.removeTrack(t);
          });
          nextStream.addTrack(newAudioTrack);
        }
      }

      if (mediaEnabledRef.current.video) {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: getVideoConstraint(),
        });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        if (newVideoTrack) {
          nextStream.getVideoTracks().forEach((t) => {
            t.stop();
            nextStream.removeTrack(t);
          });
          nextStream.addTrack(newVideoTrack);
        }
      }

      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      await updatePeerConnectionsTracks(nextStream, socket);
    } catch (e) {
      console.error('Failed to apply device selection', e);
    }
  };

  useEffect(() => {
    if (!socket) return;
    if (!pendingMediaSyncRef.current) return;

    socket.emit('media:toggle', {
      meetingId,
      type: 'audio',
      enabled: mediaEnabledRef.current.audio,
    });
    socket.emit('media:toggle', {
      meetingId,
      type: 'video',
      enabled: mediaEnabledRef.current.video,
    });

    pendingMediaSyncRef.current = false;
  }, [socket, meetingId]);

  useEffect(() => {
    if (!meetingId || meetingEnded) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    const checkMeeting = async () => {
      try {
        const res = await fetch(
          `${getApiBase()}/meetings/${meetingId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );

        if (res.status === 404) {
          setMeetingEndedReason('The meeting has ended.');
          setMeetingEnded(true);
        }
      } catch (e) {
        console.error(e);
      }
    };

    checkMeeting();
    const poller = setInterval(checkMeeting, 15000);
    return () => clearInterval(poller);
  }, [meetingId, meetingEnded]);

  const toggleMedia = async (type: 'audio' | 'video') => {
    const newVideoState = type === 'video' ? !mediaEnabled.video : mediaEnabled.video;
    const newAudioState = type === 'audio' ? !mediaEnabled.audio : mediaEnabled.audio;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Browser does not support camera/mic access, or the page is not served over HTTPS.');
        return;
      }

      let stream = localStream;

      if (!stream) {
        if (newVideoState || newAudioState) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: newVideoState ? getVideoConstraint() : false,
            audio: newAudioState ? getAudioConstraint() : false,
          });
        }
      } else {
        if (type === 'audio') {
          const audioTrack = stream.getAudioTracks()[0];
          if (newAudioState) {
            if (!audioTrack) {
              const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: getAudioConstraint(),
                video: false,
              });
              stream.addTrack(audioStream.getAudioTracks()[0]);
            } else {
              audioTrack.enabled = true;
            }
          } else {
            if (audioTrack) {
              audioTrack.stop();
              stream.removeTrack(audioTrack);
            }
          }
        } else if (type === 'video') {
          const videoTrack = stream.getVideoTracks()[0];
          if (newVideoState) {
            if (!videoTrack) {
              const videoStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: getVideoConstraint(),
              });
              stream.addTrack(videoStream.getVideoTracks()[0]);
            } else {
              videoTrack.enabled = true;
            }
          } else {
            if (videoTrack) {
              videoTrack.stop();
              stream.removeTrack(videoTrack);
            }
          }
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaEnabled({ video: newVideoState, audio: newAudioState });
      await updatePeerConnectionsTracks(stream, socket);

      if (socket) {
        socket.emit('media:toggle', { meetingId, type, enabled: type === 'video' ? newVideoState : newAudioState });
      } else {
        pendingMediaSyncRef.current = true;
      }
    } catch (err) {
      console.error('Error accessing media devices.', err);
      alert('Failed to access camera/mic.');
    }
  };

  const sendReaction = (type: string) => {
    if (socket) {
      socket.emit('reaction:send', { meetingId, type, anonymous: false });
    }
  };

  // Keep the ref pointing at the freshest version of toggleMedia on every render
  toggleMediaRef.current = toggleMedia;

  const toggleHandRaise = () => {
    const nextValue = !isHandRaised;
    setIsHandRaised(nextValue);

    if (socket) {
      socket.emit('hand:toggle', { meetingId, raised: nextValue });
    }
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (socket && chatInput.trim()) {
      socket.emit('chat:message', { meetingId, message: chatInput });
      setChatInput('');
    }
  };

  if (!meetingId) {
    return (
      <main style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>No Meeting ID provided.</h2>
        <button onClick={() => router.push('/')}>Back to Home</button>
      </main>
    );
  }

  const handleCopyId = () => {
    if (meetingId) {
      navigator.clipboard.writeText(meetingId);
      alert('Meeting ID copied to clipboard!');
    }
  };

  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const colors = {
    bgApp: '#ffffff',
    bgBottomBar: '#858a93',
    bgDarkNavy: '#212a3e',
    bgSidebar: '#e4e6ea',
    bgActiveTab: '#175073',
    red: '#ff5c5c',
    blueHighlight: '#00d2ff',
    chatReceived: '#8f95a3',
    chatSent: '#2a6a8b',
    chatInputBg: '#7e838f',
  };

  // Combine local user with remote participants (filtering out our own socket connection)
  const remoteParticipants = participants.filter(p => p.socketId !== socket?.id);
  const participantUserIdBySocketId = participants.reduce((acc: Record<string, string>, participant: any) => {
    if (participant?.socketId && participant?.userId) {
      acc[participant.socketId] = participant.userId;
    }
    return acc;
  }, {});

  const displayParticipants = [
    { isLocal: true, name: 'You', id: 'local' },
    ...remoteParticipants.map(p => ({ isLocal: false, name: p.user?.name || `User ${p.socketId?.substring(0, 5)}`, id: p.socketId }))
  ];

  type DisplayItem = {
    isLocal: boolean;
    name: string;
    id: string;
    originalId?: string;
    type: 'camera' | 'screen';
    stream?: MediaStream;
    videoEnabled?: boolean;
    audioEnabled?: boolean;
  };

  const displayItems: DisplayItem[] = [];

  // Add local camera
  displayItems.push({ isLocal: true, name: 'You', id: 'local', type: 'camera' });
  // Add local screen share if active
  if (isScreenSharing) {
    displayItems.push({ isLocal: true, name: 'You (Presenting)', id: 'local-screen', type: 'screen' });
  }

  remoteParticipants.forEach(p => {
    const streams = remoteStreams[p.socketId] || [];
    const resolvedName = meetingInfo?.participantUsers?.[p.userId]?.name || p.user?.name || `User ${p.socketId?.substring(0, 5)}`;
    displayItems.push({
      isLocal: false,
      name: resolvedName,
      id: p.socketId,
      originalId: p.socketId,
      type: 'camera',
      stream: streams[0],
      videoEnabled: p.videoEnabled,
      audioEnabled: p.audioEnabled
    });

    if (streams.length > 1) {
      const screenStream = streams[1];
      const screenTrack = screenStream?.getVideoTracks?.()[0];
      const isScreenLive = Boolean(screenTrack && screenTrack.readyState === 'live');
      if (!isScreenLive) return;
      displayItems.push({
        isLocal: false,
        name: resolvedName + ' (Presenting)',
        id: p.socketId + '-screen',
        originalId: p.socketId,
        type: 'screen',
        stream: screenStream
      });
    }
  });

  const screenShareItem = displayItems.find(item => item.type === 'screen') || null;
  const nonScreenItems = displayItems.filter(item => item.type !== 'screen');
  const hasScreenShare = Boolean(screenShareItem);

  const getGridDimensions = (count: number) => {
    if (count <= 1) return { cols: 1, rows: 1 };
    if (count <= 2) return { cols: 2, rows: 1 };
    if (count <= 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 9) return { cols: 3, rows: 3 };
    if (count <= 12) return { cols: 4, rows: 3 };
    if (count <= 16) return { cols: 4, rows: 4 };
    return { cols: 5, rows: 4 };
  };

  const gridInfo = getGridDimensions(displayItems.length);

  // Centering for an incomplete last row.
  // Technique: double the column count and make each tile span 2 sub-columns.
  // The first tile of a partial last row is shifted right by the number of
  // empty logical slots, which centers the remaining tile(s) in that row.
  const itemsInLastRow = gridInfo.cols > 0 ? displayItems.length % gridInfo.cols : 0;
  const lastRowFirstIndex = itemsInLastRow === 0 ? -1 : displayItems.length - itemsInLastRow;
  const lastRowLeadOffset = itemsInLastRow === 0 ? 0 : gridInfo.cols - itemsInLastRow; // in sub-columns

  return (
    <main style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', backgroundColor: colors.bgApp, overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>
      <style>{mobileStyles}</style>

      {isJoining && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: '#ffffff',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <style>{`
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
          `}</style>
          <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 10.5V7C17 6.44772 16.5523 6 16 6H4C3.44772 6 3 6.44772 3 7V17C3 17.5523 3.44772 18 4 18H16C16.5523 18 17 17.5523 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="#00832d" />
              <path d="M17 10.5V7C17 6.44772 16.5523 6 16 6H4C3.44772 6 3 6.44772 3 7V17C3 17.5523 3.44772 18 4 18H16C16.5523 18 17 17.5523 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="url(#joiningLogoGradient)" />
              <defs>
                <linearGradient id="joiningLogoGradient" x1="12" y1="6" x2="12" y2="18" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#00E676" />
                  <stop offset="1" stopColor="#00C853" />
                </linearGradient>
              </defs>
            </svg>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1f3b64', margin: 0, letterSpacing: '-0.02em' }}>BeeCollab</h1>
          </div>

          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(26, 115, 232, 0.1)',
            borderTop: '3px solid #1a73e8',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            marginBottom: '1.5rem'
          }}></div>

          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#202124', margin: '0 0 0.5rem 0' }}>Joining meeting...</h2>
            <p style={{ fontSize: '0.875rem', color: '#5f6368', margin: 0 }}>Please wait a moment...</p>
          </div>

          <div style={{ position: 'absolute', bottom: '3rem', display: 'flex', gap: '0.5rem' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: '8px', height: '8px', background: '#1a73e8', borderRadius: '50%', animation: `bounce 1s infinite ${i * 0.2}s` }}></div>
            ))}
          </div>
        </div>
      )}
      {showAutoplayOverlay && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9998,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          color: '#ffffff',
          padding: '1.5rem'
        }}>
          <div style={{
            background: 'rgba(20,20,20,0.9)',
            padding: '1.5rem',
            borderRadius: '14px',
            maxWidth: '420px',
            width: '90%'
          }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Enable audio/video</h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#d1d5db' }}>
              Click once to allow playback.
            </p>
            <button
              onClick={resumeMediaPlayback}
              style={{
                background: '#1a73e8',
                border: 'none',
                color: 'white',
                borderRadius: '10px',
                padding: '0.6rem 1rem',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Enable now
            </button>
          </div>
        </div>
      )}
      {meetingEnded && (
        <div className="meeting-ended-overlay" style={{
          position: 'fixed',
          inset: 0,
          background: '#ffffff',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#202124',
          textAlign: 'center',
          padding: '1.5rem',
          fontFamily: "'Google Sans', Roboto, Arial, sans-serif"
        }}>
          {/* Top Left Countdown */}
          {meetingEndType !== 'kicked' && (
            <div className="meeting-ended-countdown" style={{ position: 'absolute', top: '2rem', left: '2rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ position: 'relative', width: '36px', height: '36px' }}>
                <svg width="36" height="36" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r="18" fill="none" stroke="#e8eaed" strokeWidth="3" />
                  <circle
                    cx="20" cy="20" r="18"
                    fill="none"
                    stroke="#1a73e8"
                    strokeWidth="3"
                    strokeDasharray={113.1}
                    strokeDashoffset={113.1 - (113.1 * countdown / 30)}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 1s linear', transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                  />
                  <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fontSize="12" fontWeight="500" fill="#202124">
                    {countdown}
                  </text>
                </svg>
              </div>
              <span style={{ fontSize: '14px', color: '#5f6368' }}>Returning to home screen</span>
            </div>
          )}

          {/* Main Content */}
          <div style={{ maxWidth: '800px', width: '90%' }}>
            {/* Logo at Top */}
            <div className="meeting-ended-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', color: '#5f6368', marginBottom: '3.5rem' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 10.5V7C17 6.44772 16.5523 6 16 6H4C3.44772 6 3 6.44772 3 7V17C3 17.5523 3.44772 18 4 18H16C16.5523 18 17 17.5523 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="#00832d" />
              </svg>
              <span style={{ fontWeight: 500, fontSize: '1.6rem', letterSpacing: '-0.02em' }}>BeeCollab</span>
            </div>

            <h1 className="meeting-ended-title" style={{
              fontSize: '2.75rem',
              fontWeight: 400,
              color: '#202124',
              letterSpacing: '-0.015em',
              lineHeight: '1.25',
              maxWidth: '640px',
              margin: '0 auto 4rem'
            }}>
              {meetingEndType === 'kicked' ? "You have been removed from the meeting" :
                meetingEndType === 'expired' ? "The meeting time has ended" :
                  meetingEndType === 'full' ? "This meeting is full" :
                    "Host has ended the meeting for everyone"}
            </h1>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
              <button
                onClick={() => router.push('/')}
                style={{
                  background: '#1a73e8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '24px',
                  padding: '12px 32px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#1b66c9';
                  e.currentTarget.style.boxShadow = '0 4px 6px rgba(60,64,67,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#1a73e8';
                  e.currentTarget.style.boxShadow = '0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15)';
                }}
              >
                Return to home screen
              </button>

              {meetingEndType === 'kicked' && (
                <button
                  style={{ background: 'none', border: 'none', color: '#1a73e8', fontSize: '14px', fontWeight: 500, cursor: 'pointer', opacity: 0.8 }}
                  onClick={() => window.location.reload()}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
                >
                  Rejoin
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {isInfoOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 45, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', padding: '1.5rem', borderRadius: '14px', width: '90%', maxWidth: '360px', boxShadow: '0 12px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#202124' }}>Meeting Info</h3>
              <button onClick={() => setIsInfoOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368' }} aria-label="Close info">
                <X size={18} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', color: '#3c4043' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#5f6368' }}>Meeting name</div>
                <div style={{ fontWeight: 600 }}>{meetingInfo?.title || 'Meeting'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#5f6368' }}>Meeting code</div>
                <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{meetingInfo?.roomCode || meetingId}</div>
              </div>
            </div>
          </div>
        </div>
      )}
      {isDeviceSettingsOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 46, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', padding: '1.5rem', borderRadius: '14px', width: '92%', maxWidth: '420px', boxShadow: '0 12px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#202124' }}>Device Settings</h3>
              <button onClick={() => setIsDeviceSettingsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368' }} aria-label="Close device settings">
                <X size={18} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', color: '#3c4043' }}>
                <span style={{ fontSize: '0.75rem', color: '#5f6368' }}>Microphone</span>
                <select
                  value={selectedAudioDeviceId}
                  onChange={(e) => setSelectedAudioDeviceId(e.target.value)}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: '10px', border: '1px solid #dadce0', fontSize: '0.9rem' }}
                >
                  {audioDevices.length === 0 && <option value="">No microphone detected</option>}
                  {audioDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', color: '#3c4043' }}>
                <span style={{ fontSize: '0.75rem', color: '#5f6368' }}>Camera</span>
                <select
                  value={selectedVideoDeviceId}
                  onChange={(e) => setSelectedVideoDeviceId(e.target.value)}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: '10px', border: '1px solid #dadce0', fontSize: '0.9rem' }}
                >
                  {videoDevices.length === 0 && <option value="">No camera detected</option>}
                  {videoDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setIsDeviceSettingsOpen(false)}
                  style={{ background: '#e5e7eb', border: 'none', color: '#111827', borderRadius: '10px', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    await applyDeviceSelection();
                    setIsDeviceSettingsOpen(false);
                  }}
                  style={{ background: '#1a73e8', border: 'none', color: 'white', borderRadius: '10px', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top bar (mobile only — desktop layout is unchanged) */}
      <div className="top-bar" style={{
        display: 'none',
        height: '52px',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 0.75rem',
        background: '#1a1d21',
        color: 'white',
        flexShrink: 0,
        zIndex: 30,
        borderBottom: '1px solid rgba(255,255,255,0.08)'
      }}>
        <button
          onClick={() => setIsInfoOpen(true)}
          aria-label="Meeting info"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            borderRadius: '10px',
            padding: '0.4rem 0.7rem',
            color: 'white',
            cursor: 'pointer',
            maxWidth: 'calc(100% - 60px)',
            minWidth: 0,
            overflow: 'hidden'
          }}
        >
          <Info size={16} style={{ flexShrink: 0 }} />
          <span style={{
            fontSize: '0.85rem',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {meetingInfo?.title || 'Meeting'}
          </span>
          <span
            aria-label={isConnected ? 'Connected' : 'Connecting'}
            title={isConnected ? 'Connected' : 'Connecting...'}
            style={{
              flexShrink: 0,
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isConnected ? '#22c55e' : '#eab308',
              boxShadow: isConnected ? '0 0 6px rgba(34, 197, 94, 0.6)' : '0 0 6px rgba(234, 179, 8, 0.6)'
            }}
          />
        </button>

        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setIsLeaveMenuOpen((prev) => !prev)}
            aria-label="Leave meeting"
            style={{
              background: colors.red,
              border: 'none',
              color: 'white',
              width: '56px',
              height: '40px',
              borderRadius: '999px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <PhoneOff size={18} />
          </button>
          {isLeaveMenuOpen && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: '46px',
              background: '#1f2937',
              color: 'white',
              padding: '0.5rem',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              minWidth: '160px',
              boxShadow: '0 10px 24px rgba(0,0,0,0.3)',
              zIndex: 50
            }}>
              {isHost && (
                <button onClick={() => {
                  if (socket) socket.emit('meeting:end', { meetingId });
                  setIsLeaveMenuOpen(false);
                }} style={{ background: '#dc2626', border: 'none', color: 'white', borderRadius: '10px', padding: '0.5rem 0.75rem', cursor: 'pointer', fontWeight: 600 }}>
                  End Meeting
                </button>
              )}
              <button onClick={() => {
                setIsLeaveMenuOpen(false);
                router.push('/');
              }} style={{ background: '#374151', border: 'none', color: 'white', borderRadius: '10px', padding: '0.5rem 0.75rem', cursor: 'pointer', fontWeight: 600 }}>
                Leave Meeting
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area (Takes remaining space above bottom bar) */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', width: '100%', overflow: 'hidden' }}>

        {/* Video Grid Area */}
        <div className="video-grid-container" style={{
          flex: 1,
          padding: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s ease',
          overflow: 'hidden',
          background: '#1a1d21'
        }}>
          {hasScreenShare ? (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              gap: '1rem',
              flexDirection: window.innerWidth < 1024 ? 'column' : 'row'
            }}>
              {/* Large Screen Share Area */}
              <div style={{
                flex: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative'
              }}>
                {[screenShareItem].map((p: any) => (
                  <div key={p.id} style={{
                    width: '100%',
                    height: '100%',
                    position: 'relative',
                    background: '#000',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {p.isLocal ? (
                      <video ref={bindVideo(screenStreamRef.current)} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <video ref={bindVideo(p.stream || null)} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    )}
                    <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '8px', color: 'white', fontSize: '0.8rem', fontWeight: 500, backdropFilter: 'blur(4px)' }}>
                      {p.name}
                    </div>
                  </div>
                ))}
              </div>

              {/* Sidebar for other participants */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: window.innerWidth < 1024 ? 'row' : 'column',
                gap: '0.75rem',
                overflowX: window.innerWidth < 1024 ? 'auto' : 'hidden',
                overflowY: window.innerWidth < 1024 ? 'hidden' : 'auto',
                padding: '0.25rem',
                minWidth: window.innerWidth < 1024 ? '100%' : '200px',
                maxWidth: window.innerWidth < 1024 ? '100%' : '280px'
              }}>
                {nonScreenItems.map((p: any) => {
                  const originalId = p.originalId || p.id;
                  const participantUserId = p.isLocal ? currentUserId : participantUserIdBySocketId[originalId];
                  const queueIndex = speakingQueue.findIndex(q => q.userId === participantUserId);
                  const showHand = queueIndex !== -1;
                  const isSpeaking = speakingParticipants[p.isLocal ? 'local' : originalId];
                  const isVideoEnabled = p.isLocal ? mediaEnabled.video : (p.videoEnabled ?? true);
                  const isAudioEnabled = p.isLocal ? mediaEnabled.audio : (p.audioEnabled ?? true);

                  return (
                    <div key={p.id} style={{
                      flexShrink: 0,
                      width: window.innerWidth < 1024 ? '180px' : '100%',
                      aspectRatio: '16/9',
                      background: colors.bgDarkNavy,
                      borderRadius: '12px',
                      overflow: 'hidden',
                      position: 'relative',
                      border: isSpeaking ? `2px solid ${colors.blueHighlight}` : '2px solid transparent',
                      boxShadow: isSpeaking ? `0 0 15px ${colors.blueHighlight}44` : 'none',
                      transition: 'all 0.2s ease'
                    }}>
                      {p.isLocal ? (
                        <video ref={bindVideo(localStream)} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', position: 'absolute', top: 0, left: 0, opacity: isVideoEnabled ? 1 : 0 }} />
                      ) : (
                        <video ref={bindVideo(p.stream || null)} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, opacity: isVideoEnabled ? 1 : 0 }} />
                      )}
                      {!isVideoEnabled && (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#2c3e50', color: 'white', fontSize: '1.2rem', fontWeight: 600 }}>
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div style={{ position: 'absolute', bottom: '0.5rem', left: '0.5rem', right: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 }}>
                        <div style={{ color: 'white', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', maxWidth: '80%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', backdropFilter: 'blur(4px)' }}>
                          {p.name}
                        </div>
                        {!isAudioEnabled && <MicOff size={12} color={colors.red} style={{ background: 'rgba(0,0,0,0.5)', padding: '2px', borderRadius: '50%' }} />}
                      </div>
                      {showHand && <div style={{ position: 'absolute', top: '0.5rem', left: '0.5rem', zIndex: 5 }}><span style={{ fontSize: '14px' }}>✋</span></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: `repeat(${gridInfo.cols * 2}, minmax(0, 1fr))`,
              gap: '1.5rem',
              maxWidth: gridInfo.cols === 1 ? '800px' : '1200px',
              margin: '0 auto',
              alignContent: 'center',
              justifyContent: 'center'
            }}>
              {displayItems.map((p: any, idx: number) => {
                const originalId = p.originalId || p.id;
                const participantUserId = p.isLocal ? currentUserId : participantUserIdBySocketId[originalId];
                const queueIndex = speakingQueue.findIndex(q => q.userId === participantUserId);
                const showHand = queueIndex !== -1;
                const isSpeaking = speakingParticipants[p.isLocal ? 'local' : originalId];
                const isVideoEnabled = p.isLocal ? mediaEnabled.video : (p.videoEnabled ?? true);
                const isAudioEnabled = p.isLocal ? mediaEnabled.audio : (p.audioEnabled ?? true);
                // In audio-only mode remote video isn't downloaded — show the avatar
                const showVideo = isVideoEnabled && !(audioOnly && !p.isLocal);

                return (
                  <div key={p.id} className="participant-card" style={{
                    position: 'relative',
                    background: colors.bgDarkNavy,
                    borderRadius: '20px',
                    overflow: 'hidden',
                    aspectRatio: '16/9',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                    border: isSpeaking ? `3px solid ${colors.blueHighlight}` : '3px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    maxHeight: '100%',
                    width: '100%',
                    // Each tile occupies 2 sub-columns; the first tile of a partial
                    // last row is shifted right to center the remaining tile(s).
                    gridColumn: idx === lastRowFirstIndex
                      ? `${lastRowLeadOffset + 1} / span 2`
                      : 'span 2',
                  }}>
                    {p.isLocal ? (
                      <video ref={bindVideo(localStream)} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', position: 'absolute', top: 0, left: 0, opacity: showVideo ? 1 : 0 }} />
                    ) : (
                      <video ref={bindVideo(p.stream || null)} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, opacity: showVideo ? 1 : 0 }} />
                    )}
                    {!showVideo && (
                      <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#31415e', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', border: '2px solid rgba(255,255,255,0.1)' }}>
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    {/* Connection quality — local user only */}
                    {p.isLocal && (
                      <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '8px', backdropFilter: 'blur(4px)' }}>
                          <ConnectionBars bars={connStats.bars} />
                          <span style={{ color: 'white', fontSize: '0.7rem', fontWeight: 600 }}>
                            {connStats.rttMs != null ? `${connStats.rttMs} ms` : '—'}
                          </span>
                        </div>
                        <div style={{ color: 'white', fontSize: '0.65rem', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '8px', backdropFilter: 'blur(4px)', whiteSpace: 'nowrap' }}>
                          ↓ {fmtRate(connStats.downKbps)} · ↑ {fmtRate(connStats.upKbps)}
                        </div>
                      </div>
                    )}

                    <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', right: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
                      <div className="name-badge" style={{ color: 'white', background: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: '10px', fontSize: '0.85rem', maxWidth: '70%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', backdropFilter: 'blur(4px)' }}>
                        {p.name}
                      </div>
                      {!isAudioEnabled && (
                        <div style={{ background: 'rgba(0,0,0,0.5)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                          <MicOff size={16} color={colors.red} />
                        </div>
                      )}
                    </div>

                    {showHand && (
                      <div style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 10, animation: 'bounce 2s infinite' }}>
                        <span style={{ fontSize: '24px' }}>✋</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sidebar */}
        {activeTab && (
          <div className={`sidebar-container sidebar-${activeTab}`} style={{ width: '360px', background: 'linear-gradient(180deg, #f7f8fb 0%, #eef1f6 100%)', color: '#2b2f38', display: 'flex', flexDirection: 'column', borderLeft: '1px solid rgba(0,0,0,0.06)', flexShrink: 0, zIndex: 10, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)', borderTopLeftRadius: '24px', borderBottomLeftRadius: '24px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', padding: '1.1rem 1.25rem', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1f3b64' }}>
                {activeTab === 'people' ? `Participants (${participants.length})` :
                 activeTab === 'chat' ? 'Chat' :
                 activeTab === 'agenda' ? 'Meeting Agenda' :
                 activeTab === 'polls' ? 'Polls' : ''}
              </span>
              <button onClick={() => setActiveTab(null)} style={{ background: '#eef2f7', border: 'none', cursor: 'pointer', color: '#6b7280', width: '36px', height: '36px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={24} />
              </button>
            </div>

            {/* Chat Content */}
            {activeTab === 'chat' && (
              <>
                <style>{`
                  .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                  }
                  .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 10px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #94a3b8;
                  }
                `}</style>
                <div
                  ref={chatContainerRef}
                  className="custom-scrollbar"
                  style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
                >
                  {messages.map((m, i) => {
                    const isMe = m.senderId === localStorage.getItem('token'); // Simplification for demo
                    return (
                      <div key={i} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <div style={{ width: '34px', height: '34px', borderRadius: '12px', background: '#1f3b64', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.875rem', boxShadow: '0 4px 10px rgba(15, 23, 42, 0.15)' }}>
                          {m.sender?.name?.charAt(0) || 'U'}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', maxWidth: '85%', minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                            {isMe ? (
                              <>
                                <span style={{ fontSize: '0.75rem', color: '#8f95a3' }}>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                <strong style={{ fontSize: '0.875rem', color: '#4a4d55' }}>You</strong>
                              </>
                            ) : (
                              <>
                                <strong style={{ fontSize: '0.875rem', color: '#4a4d55' }}>{m.sender?.name || `User ${m.senderId?.substring(0, 5)}`}</strong>
                                <span style={{ fontSize: '0.75rem', color: '#8f95a3' }}>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </>
                            )}
                          </div>
                          <div style={{ background: isMe ? '#214e6f' : '#6f7686', color: 'white', padding: '0.75rem 1rem', borderRadius: '16px', borderTopRightRadius: isMe ? '6px' : '16px', borderTopLeftRadius: !isMe ? '6px' : '16px', fontSize: '0.875rem', lineHeight: '1.5', boxShadow: '0 8px 18px rgba(15, 23, 42, 0.12)', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', maxWidth: '100%' }}>
                            {m.message}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <form onSubmit={sendChat} style={{ padding: '1rem 1.25rem 1.5rem' }}>
                  <div style={{ background: '#ffffff', borderRadius: '16px', display: 'flex', alignItems: 'center', padding: '0.5rem 0.75rem 0.5rem 1rem', boxShadow: '0 10px 20px rgba(15, 23, 42, 0.08)', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <input
                      type="text"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      placeholder="Type a message..."
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#111827', fontSize: '0.9rem' }}
                    />
                    <button type="submit" disabled={!chatInput.trim()} style={{ background: chatInput.trim() ? '#1f3b64' : '#e5e7eb', border: 'none', cursor: chatInput.trim() ? 'pointer' : 'default', color: chatInput.trim() ? 'white' : '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', borderRadius: '12px' }}>
                      <Send size={20} />
                    </button>
                  </div>
                  <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.65rem', color: '#8f95a3' }}>
                    Messages can only be seen by participants in this call
                  </div>
                </form>
              </>
            )}

            {/* Other Tabs */}
            {/* Agenda Tab */}
            {activeTab === 'agenda' && (
              <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {(isHost || isCoHost) && agendas.length === 0 && (
                  <div style={{ background: '#ffffff', padding: '1rem', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Create Agenda</h3>
                    {newAgendaItems.map((item, i) => (
                      <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <input
                          type="text"
                          placeholder="Title"
                          value={item.title}
                          onChange={(e) => {
                            const updated = [...newAgendaItems];
                            updated[i].title = e.target.value;
                            setNewAgendaItems(updated);
                          }}
                          style={{ flex: 2, padding: '0.5rem', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                        />
                        <input
                          type="number"
                          placeholder="Sec"
                          value={item.duration}
                          onChange={(e) => {
                            const updated = [...newAgendaItems];
                            updated[i].duration = parseInt(e.target.value) || 0;
                            setNewAgendaItems(updated);
                          }}
                          style={{ flex: 1, padding: '0.5rem', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => setNewAgendaItems([...newAgendaItems, { title: '', duration: 60 }])}
                      style={{ width: '100%', padding: '0.5rem', border: '1px dashed #3b82f6', color: '#3b82f6', background: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '1rem' }}
                    >
                      + Add Item
                    </button>
                    <button
                      onClick={() => {
                        const items = newAgendaItems.filter(it => it.title.trim());
                        if (items.length === 0) return;
                        socket?.emit('agenda:create', { meetingId, items });
                        setNewAgendaItems([{ title: '', duration: 60 }]);
                      }}
                      style={{ width: '100%', padding: '0.75rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Save Agenda
                    </button>
                  </div>
                )}

                {activeAgenda && (
                  <div style={{ background: 'white', padding: '1rem', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Item</h3>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f3b64', marginBottom: '1rem' }}>{activeAgenda.title}</div>
                    <div style={{ height: '8px', background: '#eef2f7', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: '#3b82f6', width: '45%', transition: 'width 1s linear' }}></div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Schedule</h3>
                  {agendas.length === 0 ? (
                    <p style={{ color: '#8f95a3', fontSize: '0.875rem' }}>No agenda items set for this meeting.</p>
                  ) : (
                    agendas.map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', background: item.isActive ? '#eff6ff' : 'white', borderRadius: '12px', border: item.isActive ? '1px solid #bfdbfe' : '1px solid rgba(0,0,0,0.05)' }}>
                        <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: item.isActive ? '#3b82f6' : '#f3f4f6', color: item.isActive ? 'white' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>{i + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{item.title}</div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{Math.floor(item.duration / 60)} min</div>
                        </div>
                        {(isHost || isCoHost) && !item.isActive && (
                          <button
                            onClick={() => socket?.emit('agenda:start', { meetingId, agendaId: item.id })}
                            style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '8px', fontSize: '0.75rem', cursor: 'pointer' }}
                          >
                            Start
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Polls Tab */}
            {activeTab === 'polls' && (
              <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {(isHost || isCoHost) && (
                  <div style={{ background: '#ffffff', padding: '1rem', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Create Poll</h3>
                    <input
                      type="text"
                      placeholder="Question"
                      value={newPollQuestion}
                      onChange={(e) => setNewPollQuestion(e.target.value)}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #d1d5db', marginBottom: '0.75rem', fontSize: '0.9rem' }}
                    />
                    {newPollOptions.map((opt, i) => (
                      <input
                        key={i}
                        type="text"
                        placeholder={`Option ${i + 1}`}
                        value={opt}
                        onChange={(e) => {
                          const updated = [...newPollOptions];
                          updated[i] = e.target.value;
                          setNewPollOptions(updated);
                        }}
                        style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #d1d5db', marginBottom: '0.5rem', fontSize: '0.85rem' }}
                      />
                    ))}
                    <button
                      onClick={() => setNewPollOptions([...newPollOptions, ''])}
                      style={{ width: '100%', padding: '0.5rem', border: '1px dashed #3b82f6', color: '#3b82f6', background: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '1rem' }}
                    >
                      + Add Option
                    </button>
                    <button
                      onClick={() => {
                        if (!newPollQuestion.trim()) return;
                        socket?.emit('poll:create', { meetingId, question: newPollQuestion, options: newPollOptions.filter(o => o.trim()) });
                        setNewPollQuestion('');
                        setNewPollOptions(['', '']);
                      }}
                      style={{ width: '100%', padding: '0.75rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Launch Poll
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Recent Polls</h3>
                  {polls.length === 0 ? (
                    <p style={{ color: '#8f95a3', fontSize: '0.875rem' }}>No polls yet.</p>
                  ) : (
                    polls.map((poll) => {
                      const totalVotes = poll.options.reduce((sum: number, opt: any) => sum + (opt.responses?.length || 0), 0);
                      return (
                        <div key={poll.id} style={{ background: 'white', padding: '1rem', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)' }}>
                          <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>{poll.question}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {poll.options.map((opt: any) => {
                              const voteCount = opt.responses?.length || 0;
                              const percentage = totalVotes === 0 ? 0 : Math.round((voteCount / totalVotes) * 100);
                              return (
                                <button
                                  key={opt.id}
                                  onClick={() => socket?.emit('poll:vote', { meetingId, pollId: poll.id, optionId: opt.id })}
                                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', position: 'relative' }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                                    <span>{opt.text}</span>
                                    <span>{percentage}%</span>
                                  </div>
                                  <div style={{ height: '8px', background: '#f3f4f6', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', background: '#3b82f6', width: `${percentage}%`, transition: 'width 0.3s ease' }}></div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>{totalVotes} total votes</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {activeTab === 'people' && (
              <div style={{ padding: '1rem 1.25rem 1.5rem', flex: 1, overflowY: 'auto' }}>
                <div style={{ marginBottom: '1rem' }}>
                  <input
                    type="text"
                    value={peopleSearch}
                    onChange={(e) => setPeopleSearch(e.target.value)}
                    placeholder="Find a participant"
                    style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #d1d5db', fontSize: '0.85rem', outline: 'none', background: '#ffffff' }}
                  />
                </div>
                {participants.length === 0 && <p style={{ color: '#8f95a3', fontSize: '0.875rem', marginTop: '1rem' }}>Waiting for others to join...</p>}
                {[...participants]
                  .sort((a, b) => {
                    const isAHost = meetingInfo?.hostId === a.userId;
                    const isBHost = meetingInfo?.hostId === b.userId;
                    if (isAHost) return -1;
                    if (isBHost) return 1;

                    const queueIndexA = speakingQueue.findIndex(q => q.userId === a.userId);
                    const queueIndexB = speakingQueue.findIndex(q => q.userId === b.userId);
                    const isARaised = queueIndexA !== -1;
                    const isBRaised = queueIndexB !== -1;
                    
                    if (isARaised && !isBRaised) return -1;
                    if (!isARaised && isBRaised) return 1;
                    if (isARaised && isBRaised) return queueIndexA - queueIndexB;

                    return 0;
                  })
                  .filter((p) => {
                    if (!peopleSearch.trim()) return true;
                    // Guests aren't in participantUsers (DB) — fall back to socket profile name
                    const resolvedName = meetingInfo?.participantUsers?.[p.userId]?.name || p.user?.name;
                    const name = resolvedName || `User ${p.userId?.substring(0, 5)}`;
                    return name.toLowerCase().includes(peopleSearch.trim().toLowerCase());
                  })
                  .map((p, i) => {
                    // Guests aren't in participantUsers (DB) — fall back to socket profile name
                    const resolvedName = meetingInfo?.participantUsers?.[p.userId]?.name || p.user?.name;
                    const name = resolvedName || `User ${p.userId?.substring(0, 5)}`;
                    const isMe = currentUserId && p.userId === currentUserId;
                    const isHostLabel = meetingInfo?.hostId && p.userId === meetingInfo.hostId;
                    const isCoHostLabel = p.role === 'CO_HOST';
                    const queueIndex = speakingQueue.findIndex(q => q.userId === p.userId);
                    const isRaised = queueIndex !== -1;
                    const audioEnabled = isMe ? mediaEnabled.audio : p.audioEnabled;
                    const videoEnabled = isMe ? mediaEnabled.video : p.videoEnabled;
                    const myParticipant =
                      participants.find((participant) => participant.socketId === socket?.id) ||
                      (currentUserId ? participants.find((participant) => participant.userId === currentUserId) : undefined);
                    const myRole = myParticipant?.role;
                    const canManageParticipant =
                      !isMe &&
                      (myRole === 'HOST' || (myRole === 'CO_HOST' && !isHostLabel));

                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.5rem', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#1f3b64', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 600 }}>
                          {name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151' }}>
                            {isMe ? 'You' : name}{isHostLabel ? ' (Host)' : ''}{isCoHostLabel ? ' (Co-Host)' : ''} {isRaised && <span style={{ background: '#3b82f6', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', marginLeft: '0.25rem' }}>#{queueIndex + 1}</span>}
                          </span>
                        </div>
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
                          {audioEnabled ? <Mic size={16} color="#16a34a" /> : <MicOff size={16} color="#ef4444" />}
                          {videoEnabled ? <Video size={16} color="#16a34a" /> : <VideoOff size={16} color="#ef4444" />}
                          {canManageParticipant && (
                            <>
                              <button
                                onClick={() => setOpenParticipantMenuUserId((prev) => (prev === p.userId ? null : p.userId))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                aria-label="Participant actions"
                                data-participant-menu-button="true"
                              >
                                <MoreVertical size={16} />
                              </button>
                              {openParticipantMenuUserId === p.userId && (
                                <div data-participant-menu="true" style={{ position: 'absolute', right: 0, top: '28px', background: '#111827', color: 'white', borderRadius: '10px', padding: '0.5rem', minWidth: '170px', boxShadow: '0 12px 28px rgba(0,0,0,0.3)', zIndex: 20 }}>
                                  {!isHostLabel && (
                                    <button onClick={() => {
                                      if (socket) socket.emit('meeting:kick', { meetingId, targetSocketId: p.socketId });
                                      setOpenParticipantMenuUserId(null);
                                    }} style={{ background: 'none', border: 'none', color: 'white', padding: '0.5rem 0.6rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                                      Kick participant
                                    </button>
                                  )}
                                  {audioEnabled ? (
                                    <button onClick={() => {
                                      if (socket) socket.emit('media:force-mute', { meetingId, targetSocketId: p.socketId });
                                      setOpenParticipantMenuUserId(null);
                                    }} style={{ background: 'none', border: 'none', color: 'white', padding: '0.5rem 0.6rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                                      Mute user
                                    </button>
                                  ) : (
                                    <button onClick={() => {
                                      if (socket) socket.emit('media:ask-unmute', { meetingId, targetSocketId: p.socketId });
                                      setOpenParticipantMenuUserId(null);
                                    }} style={{ background: 'none', border: 'none', color: 'white', padding: '0.5rem 0.6rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                                      Ask to unmute
                                    </button>
                                  )}
                                  {isHost && !isCoHostLabel && (
                                    <button onClick={() => {
                                      if (socket) socket.emit('meeting:make-cohost', { meetingId, targetUserId: p.userId });
                                      setOpenParticipantMenuUserId(null);
                                    }} style={{ background: 'none', border: 'none', color: 'white', padding: '0.5rem 0.6rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                                      Make co-host
                                    </button>
                                  )}
                                  {isHost && isCoHostLabel && (
                                    <button onClick={() => {
                                      if (socket) socket.emit('meeting:remove-cohost', { meetingId, targetUserId: p.userId });
                                      setOpenParticipantMenuUserId(null);
                                    }} style={{ background: 'none', border: 'none', color: 'white', padding: '0.5rem 0.6rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                                      Remove co-host
                                    </button>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}

          </div>
        )}
      </div>

      {/* Bottom Control Bar */}
      <div className="bottom-bar" style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2rem', background: colors.bgBottomBar, color: '#f1f3f4', flexShrink: 0, zIndex: 20 }}>

        <div className="bottom-bar-info" style={{ width: '250px', fontSize: '1rem', fontWeight: 500, display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span>{currentTime}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', background: 'rgba(0,0,0,0.35)', padding: '0.2rem 0.6rem', borderRadius: '999px', color: '#f1f3f4' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: isConnected ? '#22c55e' : '#eab308' }}></span>
            {isConnected ? 'Connected' : 'Connecting...'}
          </div>
        </div>

        <div className="controls-container" style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={() => toggleMedia('audio')} className="control-btn" style={{ width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: mediaEnabled.audio ? colors.bgDarkNavy : colors.bgDarkNavy, color: mediaEnabled.audio ? 'white' : colors.red, transition: 'all 0.2s' }}>
            {mediaEnabled.audio ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button onClick={() => toggleMedia('video')} className="control-btn" style={{ width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: mediaEnabled.video ? colors.bgDarkNavy : colors.bgDarkNavy, color: mediaEnabled.video ? 'white' : colors.red, transition: 'all 0.2s' }}>
            {mediaEnabled.video ? <Video size={20} /> : <VideoOff size={20} />}
          </button>

          <button
            onClick={toggleAudioOnly}
            className="control-btn"
            title={audioOnly ? 'Data saver ON — remote video paused. Click to resume.' : 'Data saver — stop downloading remote video to save bandwidth'}
            style={{ width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: audioOnly ? '#0f4c75' : colors.bgDarkNavy, color: audioOnly ? '#ffd54a' : 'white', transition: 'all 0.2s' }}
          >
            <Gauge size={20} />
          </button>

          <button onClick={toggleHandRaise} className="control-btn" style={{ width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isHandRaised ? '#0f4c75' : colors.bgDarkNavy, color: 'white', transition: 'all 0.2s' }}>
            {isHandRaised ? <Hand size={20} /> : <Hand size={20} />}
          </button>
          
          <div style={{ position: 'relative' }}>
            <button onClick={() => sendReaction('❤️')} className="control-btn" style={{ width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bgDarkNavy, color: 'white', transition: 'all 0.2s' }}>
              <Smile size={20} />
            </button>
            {reactions.length > 0 && (
              <div style={{ position: 'absolute', bottom: '60px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.7)', padding: '0.5rem', borderRadius: '20px', backdropFilter: 'blur(8px)', zIndex: 100 }}>
                {reactions.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.9rem' }}>
                    <span>{r.type}</span>
                    <span style={{ fontWeight: 700 }}>{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={toggleScreenShare} className="control-btn screen-share-btn" style={{ width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isScreenSharing ? '#0f4c75' : colors.bgDarkNavy, color: 'white', transition: 'all 0.2s' }}>
            <MonitorUp size={20} />
          </button>

          {/* Mobile-only inline buttons (chat + people). Hidden on desktop via inline style; shown via mobile CSS. */}
          <button
            onClick={() => setActiveTab(activeTab === 'agenda' ? null : 'agenda')}
            className="control-btn mobile-action-btn"
            aria-label="Agenda"
            style={{ display: 'none', width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', alignItems: 'center', justifyContent: 'center', background: activeTab === 'agenda' ? '#0f4c75' : colors.bgDarkNavy, color: 'white', transition: 'all 0.2s' }}
          >
            <ListChecks size={20} />
          </button>
          <button
            onClick={() => setActiveTab(activeTab === 'polls' ? null : 'polls')}
            className="control-btn mobile-action-btn"
            aria-label="Polls"
            style={{ display: 'none', width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', alignItems: 'center', justifyContent: 'center', background: activeTab === 'polls' ? '#0f4c75' : colors.bgDarkNavy, color: 'white', transition: 'all 0.2s' }}
          >
            <BarChart3 size={20} />
          </button>
          <button
            onClick={() => setActiveTab(activeTab === 'chat' ? null : 'chat')}
            className="control-btn mobile-action-btn"
            aria-label="Chat"
            style={{ display: 'none', width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', alignItems: 'center', justifyContent: 'center', background: activeTab === 'chat' ? '#0f4c75' : colors.bgDarkNavy, color: 'white', transition: 'all 0.2s' }}
          >
            <MessageSquare size={20} />
          </button>
          <button
            onClick={() => setActiveTab(activeTab === 'people' ? null : 'people')}
            className="control-btn mobile-action-btn"
            aria-label="People"
            style={{ display: 'none', position: 'relative', width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', alignItems: 'center', justifyContent: 'center', background: activeTab === 'people' ? '#0f4c75' : colors.bgDarkNavy, color: 'white', transition: 'all 0.2s' }}
          >
            <Users size={20} />
            <span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#8ab4f8', color: '#202124', fontSize: '0.6rem', fontWeight: 'bold', minWidth: '14px', height: '14px', padding: '0 3px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {displayParticipants.length}
            </span>
          </button>
          <div style={{ position: 'relative' }}>
            <button
              data-kebab-menu-button="true"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
              className="control-btn"
              style={{ width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bgDarkNavy, color: 'white', transition: 'all 0.2s' }}
            >
              <MoreVertical size={20} />
            </button>
            {isMoreMenuOpen && (
              <div data-kebab-menu="true" style={{
                position: 'absolute',
                bottom: '52px',
                right: 0,
                background: '#1f2937',
                color: 'white',
                padding: '0.5rem',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                minWidth: '180px',
                boxShadow: '0 10px 24px rgba(0,0,0,0.3)',
                zIndex: 50
              }}>
                <button onClick={() => {
                  setIsDeviceSettingsOpen(true);
                  setIsMoreMenuOpen(false);
                }} style={{ background: 'none', border: 'none', color: 'white', padding: '0.55rem 0.75rem', textAlign: 'left', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}>
                  Settings
                </button>
                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    toggleScreenShare();
                    setIsMoreMenuOpen(false);
                  }}
                  style={{ display: 'none', background: 'none', border: 'none', color: 'white', padding: '0.55rem 0.75rem', textAlign: 'left', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
                >
                  {isScreenSharing ? 'Stop sharing' : 'Screen share'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bottom-bar-actions" style={{ width: '250px', display: 'flex', justifyContent: 'flex-end', gap: '1rem', color: '#e4e6ea', position: 'relative' }}>
          <button onClick={() => setIsInfoOpen(true)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}><Info size={20} /></button>
          <button onClick={() => setActiveTab(activeTab === 'agenda' ? null : 'agenda')} style={{ background: 'none', border: 'none', color: activeTab === 'agenda' ? colors.bgActiveTab : 'inherit', cursor: 'pointer' }}><ListChecks size={20} /></button>
          <button onClick={() => setActiveTab(activeTab === 'polls' ? null : 'polls')} style={{ background: 'none', border: 'none', color: activeTab === 'polls' ? colors.bgActiveTab : 'inherit', cursor: 'pointer' }}><BarChart3 size={20} /></button>
          <button onClick={() => setActiveTab(activeTab === 'people' ? null : 'people')} style={{ position: 'relative', background: 'none', border: 'none', color: activeTab === 'people' ? colors.bgActiveTab : 'inherit', cursor: 'pointer' }}>
            <Users size={20} />
            <span style={{ position: 'absolute', top: '-6px', right: '-8px', background: '#8ab4f8', color: '#202124', fontSize: '0.6rem', fontWeight: 'bold', width: '14px', height: '14px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {displayParticipants.length}
            </span>
          </button>
          <button onClick={() => setActiveTab(activeTab === 'chat' ? null : 'chat')} style={{ background: 'none', border: 'none', color: activeTab === 'chat' ? colors.bgActiveTab : 'inherit', cursor: 'pointer' }}><MessageSquare size={20} /></button>
          <button onClick={() => setIsLeaveMenuOpen((prev) => !prev)} title="Leave options" className="leave-btn" style={{ background: colors.red, border: 'none', color: 'white', cursor: 'pointer', width: '64px', height: '44px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PhoneOff size={20} />
          </button>
          {isLeaveMenuOpen && (
            <div style={{ position: 'absolute', right: 0, bottom: '46px', background: '#1f2937', color: 'white', padding: '0.5rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '160px', boxShadow: '0 10px 24px rgba(0,0,0,0.3)' }}>
              {isHost && (
                <button onClick={() => {
                  if (socket) socket.emit('meeting:end', { meetingId });
                  setIsLeaveMenuOpen(false);
                }} style={{ background: '#dc2626', border: 'none', color: 'white', borderRadius: '10px', padding: '0.5rem 0.75rem', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  End Meeting
                </button>
              )}
              <button onClick={() => {
                setIsLeaveMenuOpen(false);
                router.push('/');
              }} style={{ background: '#374151', border: 'none', color: 'white', borderRadius: '10px', padding: '0.5rem 0.75rem', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                Leave Meeting
              </button>
            </div>
          )}
        </div>

      </div>
      {showAutoplayOverlay && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', textAlign: 'center', padding: '2rem' }}
        >
          <div style={{ background: colors.bgDarkNavy, padding: '2.5rem', borderRadius: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', maxWidth: '400px', width: '100%' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(138, 180, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.blueHighlight }}>
              <Video size={32} />
            </div>
            <div>
              <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.5rem' }}>Ready to Join?</h2>
              <p style={{ margin: 0, color: '#8f95a3', fontSize: '0.875rem', lineHeight: '1.5' }}>The browser blocked autoplay. Click the button below to enable audio and video.</p>
            </div>
            <button
              onClick={async (event) => {
                event.stopPropagation();
                const videos = document.querySelectorAll('video');
                let playedAny = false;
                for (const v of Array.from(videos)) {
                  if (v.srcObject) {
                    try {
                      await v.play();
                      playedAny = true;
                    } catch (e) {
                      console.error('Failed to play video on overlay click', e);
                    }
                  }
                }
                if (playedAny) {
                  setShowAutoplayOverlay(false);
                }
              }}
              style={{ width: '100%', padding: '1rem', borderRadius: '12px', border: 'none', background: colors.blueHighlight, color: 'white', fontWeight: 600, fontSize: '1rem', cursor: 'pointer', transition: 'transform 0.2s' }}
            >
              Join Meeting
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
