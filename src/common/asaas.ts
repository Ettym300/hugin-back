import env from './env';

// https://docs.asaas.com — sandbox base is api-sandbox.asaas.com, production
// is api.asaas.com. Auth is the "access_token" header (not Bearer).

interface AsaasCustomerResponse {
  id: string;
  [key: string]: unknown;
}

interface AsaasPaymentResponse {
  id: string;
  status: string;
  invoiceUrl: string;
  [key: string]: unknown;
}

class AsaasError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

async function asaasFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!env.ASAAS_API_KEY) {
    throw new Error('ASAAS_API_KEY is not configured.');
  }
  const res = await fetch(`${env.ASAAS_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: env.ASAAS_API_KEY,
      ...init?.headers,
    },
  });

  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new AsaasError(`Asaas API request to ${path} failed (${res.status}).`, res.status, body);
  }
  return body as T;
}

export function createAsaasCustomer(opts: { name: string; cpfCnpj: string; email?: string; externalReference: string }) {
  return asaasFetch<AsaasCustomerResponse>('/v3/customers', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function createAsaasPayment(opts: {
  customer: string; // Asaas customer id
  value: number; // reais, e.g. 10.00
  dueDate: string; // "YYYY-MM-DD"
  description?: string;
  externalReference: string;
}) {
  return asaasFetch<AsaasPaymentResponse>('/v3/payments', {
    method: 'POST',
    body: JSON.stringify({
      ...opts,
      billingType: 'UNDEFINED', // lets the customer pick PIX, card, or boleto on Asaas's hosted checkout
    }),
  });
}

export { AsaasError };
