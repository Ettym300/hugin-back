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

  io.in(channelId).emit(VOICE_USER_JOINED, payload);
  // Personal room: API and WS are separate processes; joiner must always get the event.
  io.in(voice.userId).emit(VOICE_USER_JOINED, payload);
};

export const emitServerVoiceUserLeft = (channelId: string, userId: string) => {
  const io = getIO();
  const payload = { userId, channelId };

  io.in(channelId).emit(VOICE_USER_LEFT, payload);
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
