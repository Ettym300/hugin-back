import { getChannelForUserCache } from '../cache/ChannelCache';
import { getUserIdBySocketId } from '../cache/UserCache';
import { addUserToVoice, countVoiceUsersInChannel, getVoiceUserByUserId, isUserInVoice, removeVoiceUserByUserId } from '../cache/VoiceCache';
import { prisma } from '../common/database';
import env from '../common/env';
import { generateError } from '../common/errorHandler';
import { emitServerVoiceUserLeft, emitServerVoiceUserJoined, emitDMVoiceUserLeft, emitDMVoiceUserJoined } from '../emits/Voice';
import { ChannelType, TextChannelTypes } from '../types/Channel';
import { FriendStatus } from '../types/Friend';
import { MessageType } from '../types/Message';
import { createMessage } from './Message/Message';
import { createSystemMessage } from './Message/MessageCreateSystem';

export const generateTurnCredentials = async () => {
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.CLOUDFLARE_CALLS_ID}/credentials/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CLOUDFLARE_CALLS_TOKEN}`,
    },
    body: JSON.stringify({
      ttl: 86400,
    }),
  });

  if (!res.ok) {
    return null;
  }

  return ((await res.json()) as any).iceServers;
};

export const joinVoiceChannel = async (userId: string, socketId: string, channelId: string, serverId?: string) => {
  const socketUserId = await getUserIdBySocketId(socketId);

  if (socketUserId !== userId) {
    return [null, generateError('Invalid socketId or not connected to WebSocket.')] as const;
  }

  const isAlreadyInVoice = await isUserInVoice(userId);
  if (isAlreadyInVoice) {
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
  const voiceUser = await getVoiceUserByUserId(userId);
  // Always clear Redis for this user. Never 403 on channel mismatch — that left
  // ghosts in the call for everyone else while the leaver's UI already cleared.
  const leftChannelId = voiceUser?.channelId ?? channelId;

  await removeVoiceUserByUserId(userId, channelId);

  if (!leftChannelId) {
    return [true, null] as const;
  }

  const [channelCache] = await getChannelForUserCache(leftChannelId, userId);

  const serverId = channelCache?.serverId || voiceUser?.serverId;

  if (channelCache?.serverId || (!channelCache && serverId)) {
    emitServerVoiceUserLeft(leftChannelId, userId, serverId);
  } else if (channelCache) {
    emitDMVoiceUserLeft(channelCache, userId);
  } else {
    // Channel gone / no access — still notify channel + user rooms.
    emitServerVoiceUserLeft(leftChannelId, userId, serverId);
  }

  // If client asked to leave channel A but Redis had them in B, clear both views.
  if (channelId && voiceUser?.channelId && channelId !== voiceUser.channelId) {
    emitServerVoiceUserLeft(channelId, userId, serverId);
  }

  return [true, null] as const;
};
