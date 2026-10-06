/**
 * GrabNGo - Payment Provider Adapter Interface & Types (Step 9 Hardening)
 *
 * Provider-neutral contract designed for future Razorpay staging integration.
 * The application service performs all authorization, invariant verification,
 * and state machine enforcement. The adapter only handles gateway-specific API calls.
 */

export interface CreatePaymentOrderInput {
  readonly orderId: string;
  readonly internalPaymentId: string;
  readonly amountInPaise: number;
  readonly currency: 'INR';
  readonly studentUid: string;
  readonly canteenId: string;
  readonly idempotencyKey: string;
}

export interface ProviderOrderResult {
  readonly provider: string; // e.g. 'demo' | 'razorpay'
  readonly providerOrderId: string; // e.g. 'order_rzp_...' or 'demo_ord_...'
  readonly providerReference: string;
  readonly amountInPaise: number;
  readonly currency: 'INR';
  readonly status: 'created' | 'processing';
  readonly rawProviderMetadata?: Record<string, unknown>;
}

export interface VerifyPaymentInput {
  readonly orderId: string;
  readonly internalPaymentId: string;
  readonly providerOrderId: string;
  readonly providerPaymentId: string;
  readonly providerSignature: string;
}

export interface VerifiedPaymentResult {
  readonly isValid: boolean;
  readonly providerReference: string;
  readonly capturedAmountInPaise: number;
  readonly status: 'succeeded' | 'failed';
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export interface VerifyWebhookInput {
  readonly rawBodyBuffer: Buffer;
  readonly signatureHeader: string;
  readonly webhookSecret: string;
}

export interface VerifiedWebhookResult {
  readonly isValid: boolean;
  readonly eventId: string;
  readonly eventType: 'payment.captured' | 'payment.failed' | 'refund.processed';
  readonly orderId: string;
  readonly paymentId: string;
  readonly providerReference: string;
  readonly amountInPaise: number;
  readonly currency: 'INR';
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export interface RefundInput {
  readonly orderId: string;
  readonly internalPaymentId: string;
  readonly providerReference: string;
  readonly amountInPaise: number;
  readonly reason: string;
}

export interface ProviderRefundResult {
  readonly providerRefundId: string;
  readonly amountInPaise: number;
  readonly status: 'pending' | 'succeeded' | 'failed';
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

/**
 * Provider-neutral adapter interface for payment gateways.
 * A future RazorpayAdapter implements this interface without altering
 * application-level invariants, Firestore rules, or order security.
 */
export interface PaymentProviderAdapter {
  readonly providerName: string;
  createPaymentOrder(input: CreatePaymentOrderInput): Promise<ProviderOrderResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifiedPaymentResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhookResult>;
  requestRefund(input: RefundInput): Promise<ProviderRefundResult>;
}
