import { Request, Response, Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { channelVerification } from '../../middleware/channelVerification';
import { rateLimit } from '../../middleware/rateLimit';
import { CHANNEL_PERMISSIONS } from '../../common/Bitwise';
import { channelPermissions } from '../../middleware/channelPermissions';
import { createLiveKitToken, isLiveKitConfigured } from '../../services/LiveKit';
import { generateError } from '../../common/errorHandler';
import { isEmailConfirmed } from '../../common/emailConfirmation';

export function channelVoiceLiveKit(Router: Router) {
  Router.post(
    '/channels/:channelId/voice/livekit',
    authenticate({ allowBot: true }),
    channelVerification(),
    channelPermissions({
      bit: CHANNEL_PERMISSIONS.JOIN_VOICE.bit,
      message: 'You are not allowed to join voice in this channel.',
    }),
    rateLimit({
      name: 'channel_voice_livekit',
      restrictMS: 20000,
      requests: 30,
    }),
    route,
  );
}

async function route(req: Request, res: Response) {
  if (!isLiveKitConfigured()) {
    return res.status(503).json(generateError('LiveKit is not configured on this server.'));
  }

  if (req.userCache.shadowBanned) {
    return res.status(403).json(generateError('Unable to join voice.'));
  }

  if (!req.userCache.bot && !isEmailConfirmed(req.userCache.account?.emailConfirmed)) {
    return res.status(400).json(generateError('You must confirm your email to join voice.'));
  }

  const [result, error] = await createLiveKitToken({
    userId: req.userCache.id,
    username: req.userCache.username,
    channelId: req.channelCache.id,
  });

  if (error || !result) {
    return res.status(500).json(error || generateError('Failed to create LiveKit token.'));
  }

  res.json(result);
}
