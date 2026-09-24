# GrabNGo Step 11: Touch-Screen Interface and Virtual In-Screen Keyboard

## 1. Assumption & Platform Context

GrabNGo's service-desk interface is designed for an Android touch-screen kiosk, tablet, or external touch monitor running the React Native mobile application.

The virtual keyboard is an **in-app UI component** (`TouchKeyboard.tsx`). It does NOT require an OS keyboard driver, OS settings alterations, or an attached hardware keyboard.

---

## 2. In-Screen Keyboard Design (`TouchKeyboard.tsx`)

### 2.1 Layout & Keys
- **Row 1**: `1 2 3 4 5 6 7 8 9 0`
- **Row 2**: `Q W E R T Y U I O P`
- **Row 3**: `A S D F G H J K L -`
- **Row 4**: `Z X C V B N M _`
- **Row 5 (Actions)**: `CLEAR`, `SPACE`, `⌫ BACK`, `🔍 SEARCH`
- **Top Bar**: Live character counter (`currentLength/maxLength`) and `✕ HIDE KEYBOARD` button.

### 2.2 Security & Data Hygiene
1. **Scope Restriction**: Inserts characters strictly into the designated, focused order search field.
2. **Zero Credential Capture**: The virtual keyboard is never bound to password, OTP, or student authentication fields.
3. **No Keystroke Logging**: Keystrokes are handled in component state in memory. Zero keystroke logging, analytics event tracking, or remote persistence occurs.
4. **Input Sanitization**: Length is strictly bounded to 64 characters. Unsupported characters are rejected.
5. **In-Flight Locking**: Keys are disabled while an asynchronous search or transition is in flight to prevent duplicate submissions.

---

## 3. Keyboard Enable / Disable Control

A persistent, high-contrast control is visible in the service-desk header:

```
[⌨️ Virtual Keyboard: ON / OFF]
```

### 3.1 Behavior
- **Default State**: Enabled (`ON`) for touch-screen kiosks and monitors.
- **When OFF**: The virtual keyboard does not appear automatically on input focus. Attached physical keyboards remain usable.
- **When ON**: Focusing the search input or tapping the explicit `⌨️` button displays the keyboard.
- **Manual Toggle**: Attendants can toggle the setting at any time. The setting is maintained in local component state and does not affect role authorization or Firestore security.
