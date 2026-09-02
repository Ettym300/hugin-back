import { Request, Response, Router } from 'express';
import { prisma } from '../../common/database';
import env from '../../common/env';
import { grantSupporterDays } from '../../services/User/Supporter';

export function asaasWebhook(Router: Router) {
  Router.post('/supporter/webhook/asaas', route);
}

interface AsaasWebhookBody {
  id: string;
  event: string;
  payment?: {
    id: string;
    status: string;
    externalReference?: string;
  };
}

const CONFIRMED_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);

async function route(req: Request, res: Response) {
  // Not the Asaas API key — a separate secret we chose and configured as
  // this webhook's authToken in the Asaas dashboard. Reject anything that
  // doesn't have it before touching the database.
  if (!env.ASAAS_WEBHOOK_TOKEN || req.header('asaas-access-token') !== env.ASAAS_WEBHOOK_TOKEN) {
    return res.status(401).end();
  }

  const body: AsaasWebhookBody = req.body;
  if (!body?.id || !body?.event) {
    return res.status(400).end();
  }

  // Idempotency: persist the event id first (per Asaas's own guidance).
  // A unique constraint violation here means this exact delivery was
  // already processed (Asaas retries on anything but a fast 200) — ack
  // and stop, don't re-grant.
  const inserted = await prisma.asaasWebhookEvent.create({ data: { id: body.id } }).catch((err) => {
    if (err?.code === 'P2002') return null; // already seen
    throw err;
  });
  if (!inserted) {
    return res.status(200).end();
  }

  if (CONFIRMED_EVENTS.has(body.event) && body.payment?.id) {
    const payment = await prisma.asaasPayment.findUnique({
      where: { asaasPaymentId: body.payment.id },
    });

    if (payment && payment.status === 'PENDING') {
      await grantSupporterDays(payment.userId, payment.days);
      await prisma.asaasPayment.update({
        where: { id: payment.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
    }
  }

  res.status(200).end();
}
