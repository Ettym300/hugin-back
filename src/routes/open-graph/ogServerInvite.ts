import { NextFunction, Request, Response, Router } from 'express';
import { prisma } from '../../common/database';
import { makeOpenGraph } from './makeOpenGraph';
import env from '../../common/env';

export function ogServerInvite(Router: Router) {
  Router.get('/og/i/:inviteId', route);
  Router.get('/og/app/explore/servers/invites/:inviteId', route);
}

async function route(req: Request, res: Response, next: NextFunction) {
  const inviteId = req.params.inviteId as string;

  const invite = await prisma.serverInvite.findFirst({
    where: {
      code: inviteId,
    },
    select: {
      server: {
        select: {
          name: true,
          avatar: true,
        },
      },
      createdBy: { select: { username: true } },
    },
  });
  if (!invite) return next();

  const avatarPath = invite.server.avatar;

  const og = makeOpenGraph({
    url: `https://hugin.app/i/${inviteId}`,
    title: `${invite.server.name} Server on HUGIN`,
    description: `You are invited to join the ${invite.server.name} server on HUGIN.`,
    imageUrl: avatarPath ? `${env.HUGIN_CDN}${avatarPath}` : undefined,
  });

  res.send(og);
}
