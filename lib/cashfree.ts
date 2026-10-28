import crypto from 'crypto';
import { normalizeIndianMobile } from './phone';

/**
 * Cashfree Payment Gateway Service (Zero-external-dependency, native fetch)
 * Supports Sandbox (Test) and Production environments configured via .env
 */

interface CustomerDetails {
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

interface CreateOrderParams {
  orderId: string;
  orderAmount: number;
  customer: CustomerDetails;
  returnUrl: string;
  notifyUrl?: string;
  orderNote?: string;
}

export interface CashfreeOrderResponse {
  cfOrderId: string;
  orderId: string;
  orderStatus: string;
  paymentSessionId: string;
  orderAmount: number;
  orderCurrency: string;
}

export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentConfigError';
  }
}

export type CashfreeMode = 'sandbox' | 'production';

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isCashfreeConfigured(): boolean {
  return Boolean(process.env.CASHFREE_APP_ID?.trim() && process.env.CASHFREE_SECRET_KEY?.trim());
}

/**
 * Mock payments (auto-fulfilment without a gateway) are only allowed outside production
 * and only when explicitly enabled.
 */
export function isMockPaymentAllowed(): boolean {
  return !isProductionRuntime() && process.env.ALLOW_MOCK_PAYMENTS === 'true';
}

/**
 * Resolves CASHFREE_ENV. Production runtimes must set it explicitly: there is no silent sandbox default.
 */
export function getCashfreeMode(): CashfreeMode {
  const raw = (process.env.CASHFREE_ENV || '').trim().toUpperCase();
  if (raw === 'PROD' || raw === 'PRODUCTION') return 'production';
  if (raw === 'TEST' || raw === 'SANDBOX') return 'sandbox';
  if (!raw && !isProductionRuntime()) return 'sandbox';
  throw new PaymentConfigError('CASHFREE_ENV must be set to TEST/SANDBOX or PROD/PRODUCTION.');
}

/**
 * Trusted public base URL for Cashfree return and webhook URLs. Never derived from request headers.
 */
export function getAppBaseUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (configured) {
    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      throw new PaymentConfigError('NEXT_PUBLIC_APP_URL is not a valid URL.');
    }
    if (isProductionRuntime() && url.protocol !== 'https:') {
      throw new PaymentConfigError('NEXT_PUBLIC_APP_URL must use https in production.');
    }
    return url.origin;
  }
  // Vercel sets VERCEL_URL itself for preview deployments; it is not request-controlled.
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (!isProductionRuntime()) return 'http://localhost:3000';
  throw new PaymentConfigError('NEXT_PUBLIC_APP_URL must be set in production for payment return and webhook URLs.');
}

function getCredentials() {
  const appId = process.env.CASHFREE_APP_ID?.trim();
  const secretKey = process.env.CASHFREE_SECRET_KEY?.trim();
  const apiVersion = (process.env.CASHFREE_API_VERSION || '2023-08-01').trim();

  if (!appId || !secretKey) {
    throw new PaymentConfigError('Cashfree credentials (CASHFREE_APP_ID, CASHFREE_SECRET_KEY) are missing in environment variables.');
  }

  const mode = getCashfreeMode();
  const baseUrl = mode === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

  return { appId, secretKey, mode, apiVersion, baseUrl };
}

/**
 * Creates an order session on Cashfree Payment Gateway
 */
export async function createCashfreeOrder(params: CreateOrderParams): Promise<CashfreeOrderResponse> {
  const { appId, secretKey, apiVersion, baseUrl } = getCredentials();

  // Cashfree requires the customer's phone; callers must supply a real one (no substitution here).
  const cleanPhone = normalizeIndianMobile(params.customer.customerPhone);
  if (!cleanPhone) {
    throw new Error('A valid 10-digit customer mobile number is required to create a payment.');
  }

  // Customer ID must be alphanumeric and under 50 characters
  const cleanCustomerId = params.customer.customerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50) || 'cust_anonymous';

  const payload: any = {
    order_id: params.orderId,
    order_amount: Math.round(params.orderAmount * 100) / 100,
    order_currency: 'INR',
    customer_details: {
      customer_id: cleanCustomerId,
      customer_name: params.customer.customerName.slice(0, 100) || 'Parent',
      customer_email: params.customer.customerEmail || 'parent@schoolbite.in',
      customer_phone: cleanPhone,
    },
    order_meta: {
      return_url: params.returnUrl,
    },
    order_note: params.orderNote || 'SchoolBite Meal Order',
  };

  if (params.notifyUrl) {
    payload.order_meta.notify_url = params.notifyUrl;
  }

  const res = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'x-client-id': appId,
      'x-client-secret': secretKey,
      'x-api-version': apiVersion,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = data.message || data.error || `Cashfree Order Creation failed with HTTP ${res.status}`;
    console.error('[Cashfree] Order creation error:', { status: res.status, data });
    throw new Error(errorMsg);
  }

  return {
    cfOrderId: String(data.cf_order_id || ''),
    orderId: data.order_id,
    orderStatus: data.order_status,
    paymentSessionId: data.payment_session_id,
    orderAmount: Number(data.order_amount),
    orderCurrency: data.order_currency || 'INR',
  };
}

/**
 * Fetches order details directly from Cashfree to verify payment status
 */
export async function getCashfreeOrder(orderId: string): Promise<any> {
  const { appId, secretKey, apiVersion, baseUrl } = getCredentials();

  const res = await fetch(`${baseUrl}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: {
      'x-client-id': appId,
      'x-client-secret': secretKey,
      'x-api-version': apiVersion,
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Failed to fetch Cashfree order status: ${res.status}`);
  }

  return data;
}

/**
 * Fetches all payment attempts and gateway references for a given order
 */
export async function getCashfreeOrderPayments(orderId: string): Promise<any[]> {
  const { appId, secretKey, apiVersion, baseUrl } = getCredentials();

  const res = await fetch(`${baseUrl}/orders/${encodeURIComponent(orderId)}/payments`, {
    method: 'GET',
    headers: {
      'x-client-id': appId,
      'x-client-secret': secretKey,
      'x-api-version': apiVersion,
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    return [];
  }

  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

export interface VerifiedCashfreePayment {
  paid: boolean;
  orderStatus: string;
  orderAmount: number;
  orderCurrency: string;
  cfOrderId: string | null;
  payment: any | null;
}

/**
 * Authoritative payment state for an order, read from the Cashfree API (never from client or webhook payloads).
 * An order counts as paid only when Cashfree reports order_status PAID.
 */
export async function getVerifiedCashfreePayment(orderId: string): Promise<VerifiedCashfreePayment> {
  const order = await getCashfreeOrder(orderId);
  const paid = order?.order_status === 'PAID';
  const payments = paid ? await getCashfreeOrderPayments(orderId) : [];
  return {
    paid,
    orderStatus: String(order?.order_status || 'UNKNOWN'),
    orderAmount: Number(order?.order_amount),
    orderCurrency: String(order?.order_currency || ''),
    cfOrderId: order?.cf_order_id ? String(order.cf_order_id) : null,
    payment: payments.find((p: any) => p.payment_status === 'SUCCESS') || null,
  };
}

/**
 * Maps a verified Cashfree payment to the details stored on the order and payment records.
 */
export function paymentDetailsFromCashfree(verified: VerifiedCashfreePayment) {
  const pay = verified.payment || {};
  const rawMethod = typeof pay.payment_method === 'object' && pay.payment_method
    ? (Object.keys(pay.payment_method)[0] || '').toUpperCase()
    : '';
  let paymentMethod = 'UPI';
  if (rawMethod.includes('CARD')) paymentMethod = 'CARD';
  else if (rawMethod.includes('NET') || rawMethod.includes('NB')) paymentMethod = 'NET_BANKING';

  return {
    amount: Number(pay.payment_amount ?? verified.orderAmount),
    currency: String(pay.payment_currency || verified.orderCurrency || ''),
    transactionRef: String(pay.cf_payment_id || pay.bank_reference || verified.cfOrderId || ''),
    paymentMethod,
    upiId: pay.payment_method?.upi?.upi_id || null,
    cardLastFour: pay.payment_method?.card?.card_number ? String(pay.payment_method.card.card_number).slice(-4) : null,
    bankName: pay.payment_method?.netbanking?.netbanking_bank_name || null,
    cashfreeOrderId: verified.cfOrderId,
  };
}

export interface CashfreeRefund {
  refundId: string;
  cfRefundId: string | null;
  status: string;
  amount: number;
}

function mapRefund(data: any): CashfreeRefund {
  return {
    refundId: String(data.refund_id || ''),
    cfRefundId: data.cf_refund_id ? String(data.cf_refund_id) : null,
    status: String(data.refund_status || 'PENDING').toUpperCase(),
    amount: Number(data.refund_amount || 0),
  };
}

/**
 * Error from a Cashfree API call.
 * - ambiguous: outcome unknown or transient (timeout, network error, HTTP 429 or 5xx); the
 *   request may or may not have taken effect, so callers must not assume either.
 * - notFound: HTTP 404, Cashfree's documented "Resource Not found" response.
 * Anything else (400, 401, 403, 409, 422) is a definite rejection of this request, which says
 * nothing about whether the resource exists.
 */
export class CashfreeApiError extends Error {
  status: number | null;
  ambiguous: boolean;
  constructor(message: string, status: number | null, ambiguous: boolean) {
    super(message);
    this.name = 'CashfreeApiError';
    this.status = status;
    this.ambiguous = ambiguous;
  }
  get notFound(): boolean {
    return this.status === 404;
  }
}

const REFUND_API_TIMEOUT_MS = 15000;

/**
 * Stable UUID-format idempotency key per refund. Cashfree replays the original response for a
 * retried request with the same key and body, so a retry after a timeout cannot act twice.
 */
export function refundIdempotencyKey(refundId: string): string {
  const h = crypto.createHash('sha256').update(`schoolbite-refund:${refundId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function refundApiCall(url: string, init: RequestInit, failure: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(REFUND_API_TIMEOUT_MS) });
  } catch (err: any) {
    throw new CashfreeApiError(`${failure}: ${err?.name === 'TimeoutError' ? 'timed out' : 'network error'}`, null, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const transient = res.status === 429 || res.status >= 500;
    throw new CashfreeApiError(data.message || `${failure} with HTTP ${res.status}`, res.status, transient);
  }
  return data;
}

/**
 * Requests a refund for a paid order. Send the same refundId and amount on every attempt:
 * the idempotency key is derived from the refundId, and Cashfree rejects a key reused with
 * a different body.
 */
export async function createCashfreeRefund(params: {
  orderId: string;
  refundId: string;
  amount: number;
  note?: string;
}): Promise<CashfreeRefund> {
  const { appId, secretKey, apiVersion, baseUrl } = getCredentials();

  const data = await refundApiCall(
    `${baseUrl}/orders/${encodeURIComponent(params.orderId)}/refunds`,
    {
      method: 'POST',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': apiVersion,
        'x-idempotency-key': refundIdempotencyKey(params.refundId),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        refund_amount: Math.round(params.amount * 100) / 100,
        refund_id: params.refundId,
        refund_note: (params.note || 'SchoolBite order cancellation').slice(0, 100),
      }),
    },
    'Cashfree refund request failed'
  );
  return mapRefund(data);
}

export async function getCashfreeRefund(orderId: string, refundId: string): Promise<CashfreeRefund> {
  const { appId, secretKey, apiVersion, baseUrl } = getCredentials();

  const data = await refundApiCall(
    `${baseUrl}/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`,
    {
      method: 'GET',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': apiVersion,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    },
    'Failed to fetch Cashfree refund status'
  );
  return mapRefund(data);
}

/** All refunds Cashfree holds for an order (read-only). */
export async function getCashfreeOrderRefunds(orderId: string): Promise<CashfreeRefund[]> {
  const { appId, secretKey, apiVersion, baseUrl } = getCredentials();

  const res = await fetch(`${baseUrl}/orders/${encodeURIComponent(orderId)}/refunds`, {
    method: 'GET',
    headers: {
      'x-client-id': appId,
      'x-client-secret': secretKey,
      'x-api-version': apiVersion,
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  const data = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error((data as any)?.message || `Failed to fetch Cashfree refunds: ${res.status}`);
  }
  return Array.isArray(data) ? data.map(mapRefund) : [];
}

/**
 * Verifies the authenticity of Cashfree webhook notifications using HMAC-SHA256 signature
 */
export function verifyCashfreeWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp: string
): boolean {
  try {
    const secretKey = process.env.CASHFREE_SECRET_KEY?.trim();
    if (!secretKey) return false;
    const dataToSign = timestamp + rawBody;
    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(dataToSign)
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}
