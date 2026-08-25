import { AccessToken } from 'livekit-server-sdk';
import env from '../common/env';
import { generateError } from '../common/errorHandler';

export function isLiveKitConfigured() {
  return !!(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_PUBLIC_WS_URL);
}

export async function createLiveKitToken(opts: {
  userId: string;
  username?: string | null;
  channelId: string;
}) {
  if (!isLiveKitConfigured()) {
    return [null, generateError('LiveKit is not configured on this server.')] as const;
  }

  const at = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
    identity: opts.userId,
    name: opts.username || opts.userId,
    ttl: '6h',
  });

  at.addGrant({
    roomJoin: true,
    room: opts.channelId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();

  return [
    {
      url: env.LIVEKIT_PUBLIC_WS_URL!,
      token,
      room: opts.channelId,
    },
    null,
  ] as const;
}
