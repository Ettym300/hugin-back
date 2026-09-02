import { Request, Response, Router } from 'express';
import { prisma } from '../../common/database';
import { authenticate } from '../../middleware/authenticate';
import { isModMiddleware } from './isModMiddleware';
import { customExpressValidatorResult, generateError } from '../../common/errorHandler';
import { addToObjectIfExists } from '../../common/addToObjectIfExists';
import { USER_BADGES, addBit, hasBit, removeBit } from '../../common/Bitwise';
import bcrypt from 'bcrypt';
import { removeUserCacheByUserIds } from '../../cache/UserCache';
import { getIO } from '../../socket/socket';
import { AUTHENTICATE_ERROR } from '../../common/ClientEventNames';
import { ModAuditLogType } from '../../common/ModAuditLog';
import { generateId } from '../../common/flakeId';
import { checkUserPassword } from '../../services/UserAuthentication';
import { Prisma } from '@src/generated/prisma/client';
import { InventoryItemType } from '@src/services/User/User';
import { removeSessionsByUserId } from '@src/services/User/UserManagement';

export function updateUser(Router: Router) {
  Router.post('/moderation/users/:userId', authenticate(), isModMiddleware(), route);
}

interface Body {
  email?: string;
  username?: string;
  tag?: string;
  newPassword?: string;
  password?: string;

  emailConfirmed?: boolean;
  addedInventoryItems?: { itemType: string; itemId: string }[];
  removedInventoryIds?: string[];

  /** Extends (or starts) the SUPPORTER subscription by this many days from
   * whichever is later: now, or the existing expiry. Auto-revoked by a
   * daily job once it passes (see removeExpiredSupporters in index.ts). */
  supporterDays?: number;
}

async function route(req: Request, res: Response) {
  const body: Body = req.body;
  const userId = req.params.userId;

  const validateError = customExpressValidatorResult(req);
  if (validateError) {
    return res.status(400).json(validateError);
  }

  const moderatorAccount = await prisma.account.findFirst({
    where: { id: req.userCache.account?.id! },
    select: { password: true },
  });
  if (!moderatorAccount) return res.status(404).json(generateError('Something went wrong. Try again later.'));

  const isPasswordValid = await checkUserPassword(moderatorAccount.password, body.password);
  if (!isPasswordValid) return res.status(403).json(generateError('Invalid password.', 'password'));

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      account: true,
      application: true,
      username: true,
      tag: true,
      badges: true,
      inventory: true,
    },
  });

  if (!user?.account && !user?.application) return res.status(404).json(generateError('User does not exist.'));

  if (body.supporterDays !== undefined) {
    if (!user.account) {
      return res.status(400).json(generateError('Bots cannot be granted a supporter subscription.'));
    }
    if (!Number.isFinite(body.supporterDays) || body.supporterDays <= 0) {
      return res.status(400).json(generateError('supporterDays must be a positive number.'));
    }
  }

  let newBadges = user.badges;
  let modifiedFounder = false;
  let newSupporterExpiresAt: Date | undefined;

  if (body.supporterDays) {
    const currentExpiry = user.account?.supporterExpiresAt;
    const base = currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry.getTime() : Date.now();
    newSupporterExpiresAt = new Date(base + body.supporterDays * 24 * 60 * 60 * 1000);
    newBadges = addBit(newBadges, USER_BADGES.SUPPORTER.bit);
  }

  if (body.addedInventoryItems?.length) {
    body.addedInventoryItems.forEach((i) => {
      if (i.itemType === InventoryItemType.BADGE) {
        const bit = parseInt(i.itemId);
        const valid = Object.values(USER_BADGES).find((b) => b.bit === bit);
        if (!valid) return;
        if (bit === USER_BADGES.FOUNDER.bit) modifiedFounder = true;
        newBadges = addBit(newBadges, bit);
      }
    });
  }
  if (body.removedInventoryIds?.length) {
    body.removedInventoryIds.forEach((id) => {
      const inventory = user.inventory.find((i) => i.id === id);
      if (inventory?.itemType === InventoryItemType.BADGE) {
        const bit = parseInt(inventory.itemId);
        if (bit === USER_BADGES.FOUNDER.bit) modifiedFounder = true;
        newBadges = removeBit(newBadges, bit);
      }
    });
  }

  if (modifiedFounder) {
    return res.status(403).json(generateError('You cannot modify the Founder badge.'));
  }

  if (body.tag || body.username) {
    const exists = await prisma.user.findFirst({
      where: {
        tag: body.tag?.trim() || user.tag,
        username: body.username?.trim() || user.username,
        NOT: { id: userId },
      },
    });
    if (exists) return res.status(403).json(generateError('Someone already has this combination of tag and username.'));
  }

  const updateAccount = {
    ...addToObjectIfExists('email', body.email),

    ...(body.emailConfirmed !== undefined
      ? {
          emailConfirmed: true,
          emailConfirmCode: null,
        }
      : undefined),
    ...(body.newPassword?.trim?.()
      ? {
          password: await bcrypt.hash(body.newPassword.trim(), 10),
        }
      : undefined),
    ...(newSupporterExpiresAt ? { supporterExpiresAt: newSupporterExpiresAt } : undefined),
  };

  const newUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(body.addedInventoryItems?.length
        ? {
            inventory: {
              upsert: body.addedInventoryItems.map((i) => ({
                create: {
                  id: generateId(),
                  itemType: i.itemType,
                  itemId: i.itemId,
                },
                update: {},
                where: { userId_itemType_itemId: { userId: userId!, itemType: i.itemType, itemId: i.itemId } },
              })),
            },
          }
        : {}),
      ...(body.removedInventoryIds?.length
        ? {
            inventory: {
              deleteMany: { userId: userId!, id: { in: body.removedInventoryIds } },
            },
          }
        : {}),
      ...(Object.keys(updateAccount).length
        ? {
            account: { update: updateAccount },
          }
        : {}),

      ...addToObjectIfExists('username', body.username),
      ...addToObjectIfExists('tag', body.tag),
      ...addToObjectIfExists('badges', newBadges),
    },
    include: {
      account: {
        select: {
          email: true,
          supporterExpiresAt: true,
        },
      },
      profile: true,
    },
  });
  await removeUserCacheByUserIds([userId!]);

  if (body.newPassword?.trim()) {
    removeSessionsByUserId(userId!);
    const broadcaster = getIO().in(userId!);
    broadcaster.emit(AUTHENTICATE_ERROR, { message: 'Invalid Token' });
    broadcaster.disconnectSockets(true);
  }

  await prisma.modAuditLog.create({
    data: {
      id: generateId(),
      actionType: ModAuditLogType.userUpdate,
      actionById: req.userCache.id,
      username: newUser.username,
      userId: newUser.id,
    },
  });

  res.json(newUser);
}
