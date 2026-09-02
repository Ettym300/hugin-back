import { prisma } from '../../common/database';
import { USER_BADGES, addBit } from '../../common/Bitwise';
import { removeUserCacheByUserIds } from '../../cache/UserCache';
import { generateId } from '../../common/flakeId';
import { InventoryItemType } from './User';

/**
 * Extends (or starts) a user's SUPPORTER subscription by `days`, from
 * whichever is later: now, or their existing expiry — so renewing early
 * stacks on top instead of resetting the clock. Used by both the
 * moderation "grant days" action and the Asaas payment webhook.
 */
export async function grantSupporterDays(userId: string, days: number) {
  const account = await prisma.account.findUnique({
    where: { userId },
    select: { supporterExpiresAt: true },
  });
  if (!account) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { badges: true },
  });
  if (!user) return null;

  const base = account.supporterExpiresAt && account.supporterExpiresAt.getTime() > Date.now() ? account.supporterExpiresAt.getTime() : Date.now();
  const supporterExpiresAt = new Date(base + days * 24 * 60 * 60 * 1000);

  const [, updatedUser] = await prisma.$transaction([
    prisma.account.update({
      where: { userId },
      data: { supporterExpiresAt },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { badges: addBit(user.badges, USER_BADGES.SUPPORTER.bit) },
    }),
  ]);

  await removeUserCacheByUserIds([userId]);

  return { supporterExpiresAt, badges: updatedUser.badges };
}

/**
 * Grants permanent ownership (inventory) of a purchased cosmetic badge.
 * Does not equip it — the user turns it on themselves from the badge
 * catalog, same as any other owned-but-unequipped badge.
 */
export async function grantBadgeInventory(userId: string, badgeBit: number) {
  const valid = Object.values(USER_BADGES).find((b) => b.bit === badgeBit);
  if (!valid) return null;

  await prisma.inventoryItem.upsert({
    where: { userId_itemType_itemId: { userId, itemType: InventoryItemType.BADGE, itemId: badgeBit.toString() } },
    create: { id: generateId(), userId, itemType: InventoryItemType.BADGE, itemId: badgeBit.toString() },
    update: {},
  });

  await removeUserCacheByUserIds([userId]);
  return true;
}
