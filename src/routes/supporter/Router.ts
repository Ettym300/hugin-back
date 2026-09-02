import { Router } from 'express';
import { supporterCheckout } from './supporterCheckout';
import { badgeCheckout } from './badgeCheckout';
import { asaasWebhook } from './asaasWebhook';

const SupporterRouter = Router();

supporterCheckout(SupporterRouter);
badgeCheckout(SupporterRouter);
asaasWebhook(SupporterRouter);

export { SupporterRouter };
