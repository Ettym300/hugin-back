// API and WS are separate EasyPanel containers. Browsers only connect to WS.
// Voice join/leave HTTP runs on API and must publish through Redis to WS.
// Using a full Socket.IO Server on API (with no clients) is fragile; the
// official pattern is @socket.io/redis-emitter on the API process.
import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';

import * as socketIO from 'socket.io';
import http from 'http';
import { redisClient } from '../common/redis';
import { onConnection } from './events/onConnection';
import { getServerIds } from '../services/Server';
import { getFriendIds } from '../services/Friend';
import { Log } from '../common/Log';
import env from '../common/env';

type IO = socketIO.Server | Emitter;

let io: IO;

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
  if (env.TYPE === 'api') {
    const pubClient = redisClient.duplicate();
    await pubClient.connect();
    io = new Emitter(pubClient);
    Log.info('Socket.IO redis-emitter ready (API publishes to WS)');
    return;
  }

  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  io = new socketIO.Server(server, {
    transports: ['websocket'],
    cors: { origin: true, credentials: true },
    adapter: createAdapter(pubClient, subClient),
  });

  io.on('connection', onConnection);
  Log.info('Socket.IO ready (WS + redis-adapter)');
}

export function getIO() {
  return io as IO;
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
