import cors from 'cors';
import { randomBytes } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import env from './env';
import { Log } from './Log';

type PendingFile = {
  groupId?: string;
  type: string;
  tempFilename: string;
  originalFilename: string;
  mimetype: string;
  filesize: number;
};

const rootDir = path.resolve(env.CDN_DATA_DIR || path.join(process.cwd(), '.dev-cdn'));
const publicDir = path.join(rootDir, 'public');
const tempDir = path.join(rootDir, 'temp');
const pending = new Map<string, PendingFile>();

function generateFileId() {
  return `${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}

function mimeToExt(mimeType: string, filename: string) {
  const fromName = path.extname(filename || '');
  if (fromName) return fromName;
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/webp') return '.webp';
  return '.bin';
}

function requireSecret(req: Request, res: Response, next: NextFunction) {
  const expected = (env.HUGIN_CDN_SECRET || '').trim();
  const received = String(req.headers.authorization || '').trim();
  if (!expected || received !== expected) {
    res.status(401).json({ message: 'Invalid CDN secret' });
    return;
  }
  next();
}

function handleUpload(type: string) {
  return (req: Request, res: Response) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!buffer.length) {
      res.status(400).json({ message: 'Missing file' });
      return;
    }

    const filename = decodeURIComponent(String(req.headers['file-name'] || 'upload.bin'));
    const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
    const fileId = generateFileId();
    const ext = mimeToExt(mimeType, filename);
    const tempFilename = fileId + ext;
    fs.writeFileSync(path.join(tempDir, tempFilename), buffer);

    pending.set(fileId, {
      groupId: req.params.groupId,
      type,
      tempFilename,
      originalFilename: filename || tempFilename,
      mimetype: mimeType,
      filesize: buffer.length,
    });

    res.json({ fileId });
  };
}

export function startDevCdn() {
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'File-Name'],
    }),
  );
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(express.json({ limit: '2mb' }));

  const rawUpload = express.raw({ type: '*/*', limit: '50mb' });

  app.post('/internal/generate-token', requireSecret, (req, res) => {
    res.json({ token: `dev-${req.body?.userId || 'anon'}` });
  });

  app.post('/internal/verify-file', requireSecret, (req, res) => {
    const fileId = req.body?.fileId as string | undefined;
    const groupId = (req.body?.groupId as string | undefined) || undefined;
    if (!fileId) {
      res.status(400).json({ message: 'Missing fileId' });
      return;
    }

    const item = pending.get(fileId);
    if (!item) {
      res.status(404).json({ message: 'File not found' });
      return;
    }

    pending.delete(fileId);

    const ownerId = groupId || item.groupId || 'unknown';
    const relativeDir = item.type === 'emojis' ? item.type : path.join(item.type, ownerId);
    const destDir = path.join(publicDir, relativeDir);
    fs.mkdirSync(destDir, { recursive: true });

    const ext = path.extname(item.tempFilename);
    const destName = fileId + ext;
    fs.renameSync(path.join(tempDir, item.tempFilename), path.join(destDir, destName));

    const publicPath = `${relativeDir.replaceAll('\\', '/')}/${destName}`;
    res.json({
      fileId,
      path: publicPath,
      filesize: item.filesize,
      animated: item.mimetype === 'image/gif',
      duration: 0,
      mimetype: item.mimetype,
      compressed: false,
      width: 0,
      height: 0,
    });
  });

  app.delete('/internal', requireSecret, (req, res) => {
    const relativePath = req.body?.path as string | undefined;
    if (relativePath) {
      fs.rmSync(path.join(publicDir, relativePath), { force: true });
    }
    res.json({ status: true });
  });

  app.delete('/internal/batch', requireSecret, (req, res) => {
    const paths = (req.body?.paths || []) as string[];
    for (const relativePath of paths) {
      fs.rmSync(path.join(publicDir, relativePath), { force: true });
    }
    res.json({ status: true });
  });

  app.post('/avatars/:groupId', rawUpload, handleUpload('avatars'));
  app.post('/profile_banners/:groupId', rawUpload, handleUpload('profile_banners'));
  app.post('/attachments/:groupId', rawUpload, handleUpload('attachments'));
  app.post('/emojis', rawUpload, handleUpload('emojis'));

  app.use(express.static(publicDir));

  let port = 8003;
  try {
    port = parseInt(new URL(env.LOCAL_HUGIN_CDN).port || '8003', 10);
  } catch {
    port = 8003;
  }

  const host = process.env.CDN_BIND || '0.0.0.0';
  const httpServer = app.listen(port, host, () => {
    Log.info(`CDN listening on http://${host}:${port}`);
    Log.info(`CDN data directory: ${rootDir}`);
  });
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      Log.error(
        `Port ${port} is in use but Dev CDN did not start. Stop other server instances and run "pnpm dev" again.`,
      );
      process.exit(1);
    }
    throw error;
  });
}
