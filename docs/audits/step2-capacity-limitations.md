# Step 2 — Production Capacity Limitations & Architectural Boundaries

## Executive Summary

Testing was performed exclusively against the local **Firebase Emulator Suite** (`demo-grabngo-local`) on a single developer workstation. While this verified state machine invariants, payment isolation, idempotency, and concurrency safety without overselling, **local emulator performance cannot be used to prove production cloud capacity**.

```
Measured local-emulator baseline only. Production capacity is not established.
PRODUCTION CAPACITY UNKNOWN — STAGING LOAD TEST REQUIRED
```

---

## 1. Classification of Findings & Boundary Definitions

To eliminate ambiguity and prevent unsupported claims:

1. **Measured Local-Emulator Result**:
   - Observations obtained from running `node scripts/run-local-performance-test.js` against local emulator ports (8085, 5001, 9099).
   - Only measures single-machine event loop behavior, loopback network latency (<1ms), and local SQLite/memory storage.
2. **Production Capacity Estimate**:
   - Theoretical extrapolations based on vendor documentation (GCP Cloud Functions auto-scaling, Firestore distributed tablet architecture).
   - Must be labeled as documentation-based assumptions requiring live validation.
3. **Production Capacity Guarantee**:
   - **NONE**. No production capacity guarantees exist prior to conducting distributed load tests against deployed staging infrastructure.
4. **Explicit Prohibitions**:
   - The application does NOT currently prove support for **30,000 requests per second**.
   - The application does NOT currently prove support for **10,000 simultaneous payments**.
   - The application does NOT currently prove support for **100,000 concurrent users**.

---

## 2. Hard Architectural & Vendor Limits

### 2.1 Firestore Hot-Document Contention (1 Write/sec Limit)
- **Vendor Limit**: Google Cloud Firestore documents have a recommended sustained write rate limit of **1 write per second** (bursts up to 5/sec).
- **Application Touchpoint**: `canteens/{canteenId}/pickup_slots/{slotId}` is updated inside an atomic transaction on every `createOrder` checkout to increment `reservedCount`.
- **Observed Contention**: In Scenario D, 15 concurrent transactions against a single slot document triggered transaction aborts and exponential backoffs (averaging 15–25 seconds under heavy lock contention).
- **Correctness Invariant**: Despite high contention latency, zero overselling occurred (`reservedCount <= capacity`).
- **High-Scale Recommendation**: For high-volume canteen lunch rushes exceeding 1 order/sec per slot:
  - Implement distributed counter sharding for slot capacity.
  - Or decouple checkout via an asynchronous Redis / PubSub reservation queue with background reconciliation.

### 2.2 Cloud Functions Gen 2 & Cloud Run Limits
- **Cold Starts**: In local emulator memory, cold-start latency is ~34 ms. In production GCP Cloud Run / Cloud Functions Gen 2, real container provisioning, V8 isolate initialization, and dependency loading cause cold starts of **1.2s to 3.5s**.
- **Instance Concurrency & Memory**: Cloud Run instances have default limits (`concurrency = 80`, max instances quota). Sudden traffic spikes require configured `minInstances` during peak lunch hours (11:30 AM – 2:00 PM).

### 2.3 Payment Gateway Limits (Razorpay / Banking Rails)
- **Gateway Rate Limits**: Commercial payment gateways enforce strict API rate limits (typically 20–60 requests/sec per API key).
- **Banking Rails Latency**: UPI and bank authorization latencies fluctuate between 3s and 30s. The system relies on atomic idempotency locks and webhooks for eventual consistency.
- **Current Status**: All local tests use synthetic demo payments. Real live gateway integration is deferred.

---

## 3. Physical Counter Fulfillment Bottleneck

Software throughput cannot outpace physical reality:
1. **Counter Capacity**: A physical canteen pickup window can serve approximately **2 to 5 meals per minute**.
2. **Operational Purpose of Slot Capacity**: The 15-minute pickup slot limit is an essential operational throttle to prevent kitchen queue collapse, food spoilage, and student crowd surges.

---

## 4. Staging Load-Test Requirements (Next Phase Blockers)

Before any claims of production scale or 30,000 req/s readiness can be made:
1. **Staging Environment Deployment**: Functions and Firestore deployed to a dedicated GCP staging project with billing enabled.
2. **Distributed Load Generators**: Multi-region distributed runners (e.g. k6 / Locust / Artillery) generating realistic traffic profiles with mobile network latency models.
3. **Synthetic Payment Gateway Mock**: High-throughput gateway mock mimicking Razorpay webhooks and banking latency.
4. **Monitoring & Telemetry**: Cloud Monitoring dashboards tracking transaction contention aborts, cold starts, and p99 end-to-end latency.

---

## 5. Decision Gate

```
STEP 2 COMPLETE — LOCAL PERFORMANCE BASELINE CORRECTED AND RECONCILED
PRODUCTION CAPACITY UNKNOWN — STAGING LOAD TEST REQUIRED
```
