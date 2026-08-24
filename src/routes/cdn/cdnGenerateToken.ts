import { Request, Response, Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { rateLimit } from '../../middleware/rateLimit';
import { generateToken } from '@src/common/huginCDN';
import { generateError } from '@src/common/errorHandler';
import { Log } from '@src/common/Log';

export function cdnGenerateToken(Router: Router) {
  Router.post(
    '/cdn/token',
    authenticate({ allowBot: true }),
    rateLimit({
      name: 'cdn_token',
      restrictMS: 30000,
      requests: 5,
    }),
    route,
  );
}

async function route(req: Request, res: Response) {
  const [genRes, error] = await generateToken({
    userId: req.userCache.id,
  });
  if (error || !genRes) {
    Log.error('CDN generate token failed', error);
    const message = typeof error === 'string' ? error : 'Could not generate token.';
    return res.status(400).json(generateError(message));
  }

  res.json({
    token: genRes.token,
  });
}
