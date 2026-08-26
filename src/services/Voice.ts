import { getChannelForUserCache } from '../cache/ChannelCache';
import { getUserIdBySocketId } from '../cache/UserCache';
import {
  addUserToVoice,
  countVoiceUsersInChannel,
  getVoiceUserByUserId,
  removeVoiceUserByUserId,
  updateVoiceUserSocketId,
} from '../cache/VoiceCache';
import { prisma } from '../common/database';
import env from '../common/env';
import { generateError } from '../common/errorHandler';
import { emitServerVoiceUserLeft, emitServerVoiceUserJoined, emitDMVoiceUserLeft, emitDMVoiceUserJoined } from '../emits/Voice';
import { ChannelType, TextChannelTypes } from '../types/Channel';
import { FriendStatus } from '../types/Friend';
import { MessageType } from '../types/Message';
import { createMessage } from './Message/Message';
import { createSystemMessage } from './Message/MessageCreateSystem';

/** Brief WS flaps should not kick the user out of voice / LiveKit. */
const VOICE_DISCONNECT_GRACE_MS = 20_000;
const pendingVoiceLeaves = new Map<string, ReturnType<typeof setTimeout>>();

export function cancelPendingVoiceLeave(userId: string) {
  const timer = pendingVoiceLeaves.get(userId);
  if (!timer) return;
  clearTimeout(timer);
  pendingVoiceLeaves.delete(userId);
}

/** Leave voice only if the user has not re-joined with a new socket within the grace window. */
export function scheduleVoiceLeaveOnDisconnect(userId: string, socketId: string) {
  cancelPendingVoiceLeave(userId);
  const timer = setTimeout(() => {
    pendingVoiceLeaves.delete(userId);
    void (async () => {
      const voice = await getVoiceUserByUserId(userId);
      if (voice?.socketId === socketId) {
        await leaveVoiceChannel(userId);
      }
    })();
  }, VOICE_DISCONNECT_GRACE_MS);
  pendingVoiceLeaves.set(userId, timer);
}

export const generateTurnCredentials = async () => {
  if (!env.CLOUDFLARE_CALLS_ID || !env.CLOUDFLARE_CALLS_TOKEN) {
    return null;
  }

  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.CLOUDFLARE_CALLS_ID}/credentials/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CLOUDFLARE_CALLS_TOKEN}`,
    },
    body: JSON.stringify({
      ttl: 86400,
    }),
  }).catch(() => null);

  if (!res?.ok) {
    return null;
  }

  return ((await res.json()) as any).iceServers;
};

export const joinVoiceChannel = async (userId: string, socketId: string, channelId: string, serverId?: string) => {
  const socketUserId = await getUserIdBySocketId(socketId);

  if (socketUserId !== userId) {
    return [null, generateError('Invalid socketId or not connected to WebSocket.')] as const;
  }

  const existingVoice = await getVoiceUserByUserId(userId);
  // Same channel after WS reconnect: only refresh socketId — do NOT emit LEFT/JOINED
  // (that was tearing down LiveKit via setCurrentChannelId(null) on the client).
  if (existingVoice?.channelId === channelId) {
    cancelPendingVoiceLeave(userId);
    await updateVoiceUserSocketId(userId, socketId);
    return [true, null] as const;
  }

  if (existingVoice) {
    await leaveVoiceChannel(userId);
  }

  const [channelCache] = await getChannelForUserCache(channelId, userId);

  if (!channelCache) {
    return [null, generateError(`Channel does not exist.`)];
  }

  if (!TextChannelTypes.includes(channelCache.type)) {
    return [null, generateError(`Cannot join voice channel.`)];
  }

  if (channelCache.type === ChannelType.DM_TEXT) {
    const isBlocked = await prisma.friend.findFirst({
      where: {
        status: FriendStatus.BLOCKED,
        OR: [
          { userId: userId, recipientId: channelCache.inbox.recipientId },
          { userId: channelCache.inbox.recipientId, recipientId: userId },
        ],
      },
    });

    if (isBlocked) {
      return [null, generateError('Cannot join voice channel.')];
    }
  }

  const count = await countVoiceUsersInChannel(channelId);

  if (count === 0) {
    createSystemMessage({
      type: MessageType.CALL_STARTED,
      channelId,
      userId,
      serverId,
    });
  }

  const voice = await addUserToVoice(channelId, userId, {
    socketId,
    serverId,
  });

  if (channelCache.serverId) {
    emitServerVoiceUserJoined(channelId, voice);
  } else {
    emitDMVoiceUserJoined(channelCache, voice);
  }

  return [true, null] as const;
};

export const leaveVoiceChannel = async (userId: string, channelId?: string) => {
  cancelPendingVoiceLeave(userId);
  const voiceUser = await getVoiceUserByUserId(userId);
  if (!voiceUser) return [null, generateError("You're not in a call.")] as const;

  if (channelId && voiceUser.channelId !== channelId) {
    return [null, generateError('You are not in this channel.')] as const;
  }
  const [channelCache] = await getChannelForUserCache(voiceUser.channelId, userId);

  if (!channelCache) {
    return [null, generateError(`Channel does not exist.`)];
  }
  await removeVoiceUserByUserId(userId);

  if (channelCache.serverId) {
    emitServerVoiceUserLeft(voiceUser.channelId, userId);
  } else {
    emitDMVoiceUserLeft(channelCache, userId);
  }

  return [true, null] as const;
};
