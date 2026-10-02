# GrabNGo — Controlled Staging Synthetic Load-Test Plan

**Date:** 2026-10-02  
**Author:** Antigravity Performance Engineering  
**Target Environment:** Staging Project (`mad-lab-a9665`) on Firebase Blaze Tier  
**Status:** **PLAN PREPARED / EXECUTION PENDING STAGING DEPLOYMENT APPROVAL**  

---

## 1. Executive Summary & Safety Principles

This plan establishes a controlled, staged synthetic load testing protocol for the GrabNGo platform. In strict accordance with Phase 7 safety instructions:
- **No Production Load:** Testing is strictly forbidden against production.
- **Ramp-Up Safety:** Traffic increases strictly in stages with automated circuit breakers. If error rates exceed 1% or p95 exceeds 1,500ms, ramp-up halts immediately.
- **Pure Synthetic Data:** All test accounts, items, and transactions are synthetic and tagged with `is_synthetic: true`.
- **Zero Real Money:** Only synthetic demo payments are executed.

---

## 2. Conservative Staged Ramp-Up Stages

| Stage | Target Throughput | Concurrency | Target Duration | Circuit Breaker (Halt Condition) |
|---|---|---|---|---|
| **Stage 1: Baseline Smoke** | 1 req/sec | 1 virtual user | 2 minutes | Error rate > 0%, p95 > 1,000 ms |
| **Stage 2: Small Load** | 10 req/sec | 10 virtual users | 5 minutes | Error rate > 0.5%, p95 > 1,200 ms |
| **Stage 3: Moderate Load** | 100 req/sec | 100 virtual users | 10 minutes | Error rate > 1.0%, p95 > 2,000 ms |
| **Stage 4: Peak Lunch Rush** | 250 req/sec | 250 virtual users | 10 minutes | Error rate > 2.0%, transaction abort > 5% |

*Gate Rule:* Advancing from Stage N to Stage N+1 requires 100% passage of all correctness assertions in Stage N.

---

## 3. Subsystem Test Profiles & Workload Mix

Traffic will be distributed according to actual student canteen usage patterns:

```
Total Load Distribution:
├── 60% Catalog Browsing & Search (Firestore reads)
├── 15% Cart Operations & Item Validation
├── 10% Checkout & Order Creation (createOrder transactions)
├──  8% Payment Execution (createDemoPayment & completeDemoPayment)
├──  5% In-App Notification Polling & Outbox Processing
└──  2% Service-Desk Kiosk Queue & Status Handover
```

### Profile A: Catalog & Menu Item Reads
- Operations: `getCanteenCatalog`, `getAvailableCategories`, Firestore query on active menu items.
- Focus: Cache efficiency, read latency, Firestore index performance.

### Profile B: Cart Validation & Checkout (`createOrder`)
- Operations: Multi-item price recomputation, 10-shard slot capacity reservation.
- Focus: Shard contention, transaction lock duration, idempotency validation under network jitter.

### Profile C: Demo Payment Lifecycle
- Operations: `createDemoPayment`, `completeDemoPayment`, synthetic webhook ingestion.
- Focus: Two-phase commit integrity, order state transition from `payment_pending` to `payment_verified`.

### Profile D: Notification Worker & Outbox Delivery
- Operations: Background Cloud Function event triggers, outbox worker processing.
- Focus: Outbox delivery lag, deduplication, retry handling.

### Profile E: Service Desk Operational Kiosk
- Operations: `listOperationalOrders`, `getOperationalOrderDetails`, `transitionOperationalOrderStatus`.
- Focus: Kitchen queue visibility, UID masking efficiency, order state handover latency.

---

## 4. Telemetry & Metrics Collection Protocol

During each load stage, the test harness will capture:

1. **Latency Metrics:** p50, p90, p95, p99, and maximum response times per endpoint.
2. **Error & Failure Rates:** HTTP 4xx (validation/auth), HTTP 5xx (server errors), and timeouts (>10s).
3. **Firestore Transaction Aborts:** Internal Firestore `ABORTED` retry counts during slot reservations.
4. **Cloud Functions Cold Starts:** Initialization duration vs warm invocation latency.
5. **Resource Utilization:** Cloud Run CPU utilization, memory consumption, active instance count.
6. **Billing & Operation Volume:** Total Firestore document reads, writes, and Cloud Functions invocations.

---

## 5. Inviolable Correctness Assertions

Every load stage must verify 100% compliance with these invariants:

1. **Idempotency Guarantee:** Replaying identical idempotency keys produces exactly 1 order document (0 duplicates).
2. **No Duplicate Payments:** Replaying payment completion produces exactly 1 successful payment record.
3. **No Phantom Payments:** Zero payments exist without a corresponding valid order document.
4. **Authoritative Total Integrity:** Every order total exactly equals the sum of its items calculated from server prices.
5. **Zero Slot Oversell:** For any pickup slot with capacity $C$, total reservations across all shards satisfy $\sum \text{reservedCount} \le C$.
6. **Zero Cross-User Visibility:** Student A cannot read or receive orders or notifications belonging to Student B.
7. **Zero Cross-Canteen Leakage:** Service-desk staff assigned to Canteen X cannot view orders belonging to Canteen Y.
8. **Service Desk Financial Isolation:** Service-desk staff attempts to initiate refunds or approve payments fail with `PERMISSION_DENIED`.
9. **Zero Lost In-App Notifications:** Every completed state transition produces exactly one durable `/notifications` record.
