// Classic pub/sub adapter: redis-streams-adapter often drops room emits between
// separate API and WS processes (socket.io#5445). Clients connect to WS; voice
// join/leave HTTP runs on API and must broadcast via Redis.
import { createAdapter } from '@socket.io/redis-adapter';

import * as socketIO from 'socket.io';
import http from 'http';
import { redisClient } from '../common/redis';
import { onConnection } from './events/onConnection';
import { getServerIds } from '../services/Server';
import { getFriendIds } from '../services/Friend';
import { Log } from '../common/Log';

let io: socketIO.Server;

const membersFetched: Record<string, Set<string>> = {};
export const hasFetchedMembers = (socketId: string, serverId: string) => membersFetched[socketId]?.has(serverId);
export const markMembersFetched = (socketId: string, serverId: string) => {
  const set = (membersFetched[socketId] ??= new Set());
  set.add(serverId);
  if (set.size > 10) {
    set.delete(set.values().next().value!);
  }
};
export const clearMembersFetched = (socketId: string) => delete membersFetched[socketId];

export async function createIO(server?: http.Server) {
  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  io = new socketIO.Server(server, {
    transports: ['websocket'],
    cors: { origin: true, credentials: true },
    adapter: createAdapter(pubClient, subClient),
  });

  io.on('connection', onConnection);
  Log.info('Socket.IO ready (redis-adapter)');
}

export function getIO() {
  return io as socketIO.Server;
}

interface EmitToAllOptions {
  event: string;
  payload: any;
  userId: string;
  excludeSocketId?: string;
  excludeSelf?: boolean;
}

// emit to your friends and your servers.
// Note: when broadcasting to an empty array, it will emit to everyone :(
export async function emitToAll(opts: EmitToAllOptions) {
  const { event, payload, userId, excludeSocketId, excludeSelf } = opts;
  const serverIds = await getServerIds(userId);
  const friendIds = await getFriendIds(userId);

  const concatIds = [...serverIds, ...friendIds, userId];
  if (concatIds.length === 0) return;

  let broadcaster = getIO().to(concatIds);

  if (excludeSelf) {
    broadcaster = broadcaster.except(userId);
  }

  if (excludeSocketId) {
    broadcaster = broadcaster.except(excludeSocketId);
  }
  broadcaster.emit(event, payload);
}
