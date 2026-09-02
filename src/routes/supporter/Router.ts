import { Router } from 'express';
import { supporterCheckout } from './supporterCheckout';
import { asaasWebhook } from './asaasWebhook';

const SupporterRouter = Router();

supporterCheckout(SupporterRouter);
asaasWebhook(SupporterRouter);

export { SupporterRouter };
