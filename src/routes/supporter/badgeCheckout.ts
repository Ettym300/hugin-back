import { Request, Response, Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../../middleware/authenticate';
import { rateLimit } from '../../middleware/rateLimit';
import { customExpressValidatorResult, generateError } from '../../common/errorHandler';
import { prisma } from '../../common/database';
import { generateId } from '../../common/flakeId';
import env from '../../common/env';
import { createAsaasCustomer, createAsaasPayment, AsaasError } from '../../common/asaas';
import { USER_BADGES } from '../../common/Bitwise';

export function badgeCheckout(Router: Router) {
  Router.post(
    '/shop/badge-checkout',
    authenticate(),
    body('name').not().isEmpty().withMessage('name is required.').isString(),
    body('cpfCnpj').not().isEmpty().withMessage('cpfCnpj is required.').isString(),
    body('badgeBit').not().isEmpty().withMessage('badgeBit is required.').isNumeric(),
    rateLimit({
      name: 'badge-checkout',
      restrictMS: 60000,
      requests: 5,
      useIP: true,
    }),
    route,
  );
}

interface Body {
  name: string;
  cpfCnpj: string;
  badgeBit: number;
}

async function route(req: Request, res: Response) {
  if (!env.ASAAS_API_KEY) {
    return res.status(503).json(generateError('Badge checkout is not configured.'));
  }

  const validateError = customExpressValidatorResult(req);
  if (validateError) {
    return res.status(400).json(validateError);
  }

  const body: Body = req.body;
  const userId = req.userCache.id;

  // Only cosmetic overlay badges ("animal ears") are for sale — never trust
  // the client for which badge or how much it costs.
  const badge = Object.values(USER_BADGES).find((b) => b.bit === body.badgeBit);
  if (!badge || !('overlay' in badge) || !badge.overlay) {
    return res.status(400).json(generateError('This badge is not for sale.', 'badgeBit'));
  }

  const cpfCnpj = body.cpfCnpj.replace(/\D/g, '');
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return res.status(400).json(generateError('cpfCnpj must be a valid CPF (11 digits) or CNPJ (14 digits).', 'cpfCnpj'));
  }

  try {
    let asaasCustomer = await prisma.asaasCustomer.findUnique({ where: { userId } });

    if (!asaasCustomer) {
      const account = await prisma.account.findUnique({ where: { userId }, select: { email: true } });
      const created = await createAsaasCustomer({
        name: body.name.trim(),
        cpfCnpj,
        email: account?.email,
        externalReference: userId,
      });
      asaasCustomer = await prisma.asaasCustomer.create({
        data: {
          id: generateId(),
          userId,
          asaasCustomerId: created.id,
        },
      });
    }

    const paymentId = generateId();
    const valueCents = env.BADGE_PRICE_CENTS;
    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const asaasPayment = await createAsaasPayment({
      customer: asaasCustomer.asaasCustomerId,
      value: valueCents / 100,
      dueDate,
      description: `Hugin — Emblema cosmético`,
      externalReference: paymentId,
    });

    await prisma.asaasPayment.create({
      data: {
        id: paymentId,
        userId,
        asaasPaymentId: asaasPayment.id,
        productType: 'BADGE',
        badgeBit: body.badgeBit,
        valueCents,
        status: 'PENDING',
      },
    });

    res.json({ invoiceUrl: asaasPayment.invoiceUrl });
  } catch (err) {
    if (err instanceof AsaasError) {
      console.error('Asaas badge checkout error:', err.status, err.body);
      return res.status(502).json(generateError('Payment provider rejected the request. Double-check your CPF/CNPJ and try again.'));
    }
    console.error('Badge checkout failed:', err);
    return res.status(500).json(generateError('Something went wrong. Try again later.'));
  }
}
