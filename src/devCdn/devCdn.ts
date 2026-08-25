import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import env from '../common/env';
import { generateId } from '../common/flakeId';

type UploadType = 'avatars' | 'profile_banners' | 'emojis' | 'attachments';

type PendingUpload = {
  fileId: string;
  groupId: string;
  userId: string;
  type: UploadType;
  tempPath: string;
  mimetype: string;
  filesize: number;
  animated: boolean;
};

const pendingUploads = new Map<string, PendingUpload>();

export const devCdnRoot = path.join(process.cwd(), '.dev-cdn');
export const devCdnPublicRoot = path.join(devCdnRoot, 'public');
export const devCdnTempRoot = path.join(devCdnRoot, 'temp');

export async function ensureDevCdnDirs() {
  await fsp.mkdir(devCdnTempRoot, { recursive: true });
  await fsp.mkdir(devCdnPublicRoot, { recursive: true });
}

export function isDevCdnEnabled() {
  return env.DEV_MODE;
}

export function generateDevCdnToken(opts: { userId: string; channelId?: string }) {
  const token = jwt.sign(
    {
      userId: opts.userId,
      channelId: opts.channelId,
      aud: 'cdn-upload',
    },
    env.RUGIN_CDN_SECRET,
    { expiresIn: '5m' },
  );

  return [{ token }, null] as const;
}

export function verifyDevCdnUploadToken(token: string) {
  try {
    const decoded = jwt.verify(token, env.RUGIN_CDN_SECRET) as jwt.JwtPayload;
    if (decoded.aud !== 'cdn-upload' || typeof decoded.userId !== 'string') return null;
    return {
      userId: decoded.userId,
      channelId: typeof decoded.channelId === 'string' ? decoded.channelId : undefined,
    };
  } catch {
    return null;
  }
}

function pendingKey(fileId: string, groupId: string) {
  return `${fileId}:${groupId}`;
}

export async function saveDevCdnUpload(opts: {
  type: UploadType;
  groupId: string;
  userId: string;
  tempPath: string;
  mimetype: string;
  filesize: number;
}) {
  const fileId = generateId();
  const ext = path.extname(opts.tempPath) || '.webp';
  const tempFilename = `${fileId}${ext}`;
  const nextTempPath = path.join(devCdnTempRoot, tempFilename);

  await fsp.rename(opts.tempPath, nextTempPath);

  pendingUploads.set(pendingKey(fileId, opts.groupId), {
    fileId,
    groupId: opts.groupId,
    userId: opts.userId,
    type: opts.type,
    tempPath: nextTempPath,
    mimetype: opts.mimetype,
    filesize: opts.filesize,
    animated: opts.mimetype === 'image/gif',
  });

  return fileId;
}

export async function verifyDevCdnUpload(opts: {
  userId: string;
  fileId: string;
  groupId?: string;
  imageOnly?: boolean;
}) {
  if (!opts.groupId) {
    return [null, 'Missing groupId.'] as const;
  }

  const pending = pendingUploads.get(pendingKey(opts.fileId, opts.groupId));
  if (!pending) {
    return [null, 'File not found or already verified.'] as const;
  }

  if (pending.userId !== opts.userId) {
    return [null, 'You are not allowed to verify this upload.'] as const;
  }

  if (opts.imageOnly && !pending.mimetype.startsWith('image/')) {
    return [null, 'Only images are allowed.'] as const;
  }

  const ext = path.extname(pending.tempPath) || '.webp';
  const relativeDir = path.posix.join(pending.type, pending.groupId);
  const publicDir = path.join(devCdnPublicRoot, pending.type, pending.groupId);
  const webpPath = path.join(publicDir, `${pending.fileId}.webp`);
  const animatedPath = path.join(publicDir, `${pending.fileId}.gif`);

  await fsp.mkdir(publicDir, { recursive: true });

  let animated = pending.mimetype === 'image/gif';
  if (animated) {
    const metadata = await sharp(pending.tempPath, { animated: true }).metadata();
    animated = (metadata.pages ?? 1) > 1;
  }

  if (animated) {
    await fsp.copyFile(pending.tempPath, animatedPath);
    await sharp(pending.tempPath, { animated: true, page: 0 }).webp().toFile(webpPath);
  } else {
    await sharp(pending.tempPath).webp().toFile(webpPath);
  }

  // Ensure the static preview is a single frame even if sharp kept animation metadata.
  if (animated) {
    const staticWebp = await sharp(webpPath, { animated: true, page: 0 }).webp().toBuffer();
    await fsp.writeFile(webpPath, staticWebp);
  }

  await fsp.unlink(pending.tempPath).catch(() => undefined);
  pendingUploads.delete(pendingKey(opts.fileId, opts.groupId));

  const webpStat = await fsp.stat(webpPath);
  const response = {
    fileId: pending.fileId,
    path: `${relativeDir}/${pending.fileId}.webp${animated ? '#a' : ''}`.replaceAll('\\', '/'),
    filesize: webpStat.size,
    animated,
    duration: 0,
    mimetype: 'image/webp',
    compressed: true,
  };

  return [response, null] as const;
}

export async function writeDevCdnTempFile(
  stream: NodeJS.ReadableStream,
  originalName = 'upload.bin',
) {
  await ensureDevCdnDirs();
  const ext = path.extname(originalName) || '.bin';
  const tempPath = path.join(devCdnTempRoot, `${generateId()}${ext}`);
  await pipeline(stream, fs.createWriteStream(tempPath));
  const stat = await fsp.stat(tempPath);
  return { tempPath, filesize: stat.size };
}
