import { ChannelCache } from '../cache/ChannelCache';
import { VoiceCacheFormatted } from '../cache/VoiceCache';
import { VOICE_USER_JOINED, VOICE_USER_LEFT } from '../common/ClientEventNames';
import { getIO } from '../socket/socket';

export const emitServerVoiceUserJoined = (
  channelId: string,
  voice: VoiceCacheFormatted
) => {
  const io = getIO();
  const payload = voice;

  // channelId: members who joined that channel room
  io.in(channelId).emit(VOICE_USER_JOINED, payload);
  // serverId: every online member joins this on auth — reliable across API/WS split
  if (voice.serverId) {
    io.in(voice.serverId).emit(VOICE_USER_JOINED, payload);
  }
  // Personal room: joiner must always get the event
  io.in(voice.userId).emit(VOICE_USER_JOINED, payload);
};

export const emitServerVoiceUserLeft = (
  channelId: string,
  userId: string,
  serverId?: string
) => {
  const io = getIO();
  const payload = { userId, channelId };

  io.in(channelId).emit(VOICE_USER_LEFT, payload);
  if (serverId) {
    io.in(serverId).emit(VOICE_USER_LEFT, payload);
  }
  io.in(userId).emit(VOICE_USER_LEFT, payload);
};

export const emitDMVoiceUserJoined = (
  channel: ChannelCache,
  voice: VoiceCacheFormatted
) => {
  const io = getIO();

  const userIds = [channel.inbox?.recipientId as string, channel.inbox?.createdById as string];

  io.in(userIds).emit(VOICE_USER_JOINED, voice);
};

export const emitDMVoiceUserLeft = (channel: ChannelCache, userId: string) => {
  const io = getIO();

  const userIds = [channel.inbox?.recipientId as string, channel.inbox?.createdById as string];

  io.in(userIds).emit(VOICE_USER_LEFT, { userId, channelId: channel.id });
};
