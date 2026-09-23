# Step 9 Audit — Payment State Machine

## 1. Valid Payment Lifecycle States
The payment state machine supports the following states:
```
[created] ---> [processing] ---> [succeeded_demo] ---> [refund_pending] ---> [refunded_demo]
      \              |
       \             v
        +-------> [failed] (Terminal for attempt, order status remains placed)
        |
        +-------> [cancelled] (Terminal for attempt)
```

- `created`: Attempt registered by student with valid idempotency key.
- `processing`: Gateway simulation initiated.
- `succeeded_demo`: Payment verified and completed. Transitions order status to `payment_verified`. Terminal success for the order.
- `failed`: Simulation resulted in failure. The attempt record is immutable. Order returns to `paymentStatus: "failed"` allowing a new attempt with a fresh idempotency key.
- `cancelled`: Attempt aborted prior to completion.
- `refund_pending`: Order cancelled or rejected; refund workflow initiated.
- `refunded_demo`: Demo refund finalized.

## 2. Failed Attempt Immutability & Retry Invariants
1. **Failed Records are Immutable**: Once marked `failed`, a payment record cannot be updated, transitioned, or overwritten to `succeeded_demo`.
2. **New Attempt ID**: Every retry generates a new unique `paymentId`.
3. **New Idempotency Key**: Retrying with the same idempotency key returns the existing attempt rather than creating a duplicate. A new attempt requires a new idempotency key.
4. **Authoritative Total Re-read**: The server always queries `/orders/{orderId}` to fetch `pricing.total` rather than trusting client-supplied values.
5. **Max Failed Attempts**: Limited to 3 failed attempts per order to prevent attempt flooding.

## 3. Terminal State Invariants
- An order that reaches `succeeded_demo` / `payment_verified` cannot have any subsequent payment attempts created or completed.
- Two concurrent attempts cannot both succeed: Firestore transactions reject the second attempt because `order.paymentStatus` is already `succeeded_demo` or `status` is already `payment_verified`.
- Only a single `payment_verified` status history event can ever exist for an order.
