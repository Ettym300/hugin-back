import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns/promises';
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

export const devCdnRoot = path.resolve(
  env.CDN_DATA_DIR || path.join(process.cwd(), '.dev-cdn'),
);
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

  const relativeDir = path.posix.join(pending.type, pending.groupId);
  const publicDir = path.join(devCdnPublicRoot, pending.type, pending.groupId);
  const webpPath = path.join(publicDir, `${pending.fileId}.webp`);
  const animatedPath = path.join(publicDir, `${pending.fileId}.gif`);

  try {
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
  } catch (err) {
    console.error('[devCdn] verify upload failed', err);
    await fsp.unlink(webpPath).catch(() => undefined);
    await fsp.unlink(animatedPath).catch(() => undefined);
    return [null, 'Unsupported image format.'] as const;
  } finally {
    await fsp.unlink(pending.tempPath).catch(() => undefined);
    pendingUploads.delete(pendingKey(opts.fileId, opts.groupId));
  }
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

const MAX_PROXY_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB
const PROXY_FETCH_TIMEOUT_MS = 10_000;

function isPrivateOrLocalIP(ip: string) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    return false;
  }
  return true; // not a resolvable IP -> treat as unsafe
}

async function assertPublicHttpUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported URL protocol.');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost') {
    throw new Error('Blocked host.');
  }

  const addresses = net.isIP(hostname)
    ? [hostname]
    : (await dns.lookup(hostname, { all: true })).map((a) => a.address);

  if (!addresses.length || addresses.some(isPrivateOrLocalIP)) {
    throw new Error('Blocked host.');
  }

  return url;
}

// Fetches an external image URL server-side and returns its dimensions.
// Used to embed images/gifs (Klipy, Giphy, etc.) linked in messages.
export async function proxyImageDimensions(rawUrl: string) {
  const url = await assertPublicHttpUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'RuginBot/1.0 (+https://rugin.com/bot)' },
      redirect: 'follow',
    });

    if (!res.ok || !res.body) {
      throw new Error('Could not fetch image.');
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new Error('URL is not an image.');
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROXY_IMAGE_BYTES) {
        throw new Error('Image too large.');
      }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks);
    const metadata = await sharp(buffer, { animated: true }).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Unsupported image format.');
    }

    return {
      width: metadata.width,
      height: metadata.height,
      animated: (metadata.pages ?? 1) > 1,
    };
  } finally {
    clearTimeout(timeout);
  }
}
