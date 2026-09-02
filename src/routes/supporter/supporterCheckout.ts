import { Request, Response, Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../../middleware/authenticate';
import { rateLimit } from '../../middleware/rateLimit';
import { customExpressValidatorResult, generateError } from '../../common/errorHandler';
import { prisma } from '../../common/database';
import { generateId } from '../../common/flakeId';
import env from '../../common/env';
import { createAsaasCustomer, createAsaasPayment, AsaasError } from '../../common/asaas';

export function supporterCheckout(Router: Router) {
  Router.post(
    '/supporter/checkout',
    authenticate(),
    body('name').not().isEmpty().withMessage('name is required.').isString(),
    body('cpfCnpj').not().isEmpty().withMessage('cpfCnpj is required.').isString(),
    rateLimit({
      name: 'supporter-checkout',
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
}

async function route(req: Request, res: Response) {
  if (!env.ASAAS_API_KEY) {
    return res.status(503).json(generateError('Supporter checkout is not configured.'));
  }

  const validateError = customExpressValidatorResult(req);
  if (validateError) {
    return res.status(400).json(validateError);
  }

  const body: Body = req.body;
  const userId = req.userCache.id;
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
    const days = env.SUPPORTER_DAYS_PER_PAYMENT;
    const valueCents = env.SUPPORTER_PRICE_CENTS;
    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const asaasPayment = await createAsaasPayment({
      customer: asaasCustomer.asaasCustomerId,
      value: valueCents / 100,
      dueDate,
      description: `Hugin Apoiador — ${days} dias`,
      externalReference: paymentId,
    });

    await prisma.asaasPayment.create({
      data: {
        id: paymentId,
        userId,
        asaasPaymentId: asaasPayment.id,
        days,
        valueCents,
        status: 'PENDING',
      },
    });

    res.json({ invoiceUrl: asaasPayment.invoiceUrl });
  } catch (err) {
    if (err instanceof AsaasError) {
      console.error('Asaas checkout error:', err.status, err.body);
      return res.status(502).json(generateError('Payment provider rejected the request. Double-check your CPF/CNPJ and try again.'));
    }
    console.error('Supporter checkout failed:', err);
    return res.status(500).json(generateError('Something went wrong. Try again later.'));
  }
}
