# GrabNGo Step 11: Frontend Integration and Kiosk Safety

## 1. Service Desk UI (`AdminLandingScreen.tsx`)

The Service Desk UI is built for large touch displays, kiosks, and Android monitors:

1. **Large Touch Targets**: Minimum 48x48 pt touch target size across all buttons, inputs, and pills.
2. **Session Header**:
   - Displays operator UID and role (`Service Desk` or `Canteen Admin`).
   - Displays assigned canteen(s).
   - In-Screen Keyboard ON / OFF toggle.
   - Clean Log Out action.
3. **Queue Cards**:
   - High-contrast status badges.
   - Order ID, masked customer (`student_...1a2b`), total, pickup slot, item count.
   - Display-only payment and refund status notices.
   - Quick action buttons (Accept, Preparing, Ready, Complete, Reject).
4. **Order Detail & Audit Modal**:
   - Lists all snapshot items.
   - Chronological immutable audit history.
   - Operational notes with author role and timestamps.
   - "+ Add Note" action.
5. **Safe Session Logout**:
   - Tapping "Log Out" clears all search queries, search results, selected order details, active modals, and resets the virtual keyboard before signing out via Firebase Auth.
   - Zero customer data or order documents are persisted in device local storage.
