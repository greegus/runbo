# RunPlan Pro — Implementation Specification

**Version 1.0 | January 2026**

This document provides detailed technical specifications for implementing RunPlan Pro, including authentication flows, screen designs, feature interactions, and backend API definitions.

---

## Table of Contents

1. [Authentication & Authorization](#authentication--authorization)
2. [Screen Specifications](#screen-specifications)
3. [Feature Interactions](#feature-interactions)
4. [Backend API](#backend-api)
5. [Firestore Data Schema](#firestore-data-schema)
6. [Cloud Functions](#cloud-functions)
7. [Error Handling](#error-handling)
8. [Core Algorithms](#core-algorithms)
9. [Testing Strategy](#testing-strategy)
10. [CI/CD Pipeline](#cicd-pipeline)
11. [PWA & Offline Strategy](#pwa--offline-strategy)
12. [Push Notifications & FCM Token Management](#push-notifications--fcm-token-management)
13. [Operational Concerns](#operational-concerns)

---

## Authentication & Authorization

### Overview

RunPlan Pro uses Firebase Authentication with two providers:

1. **Email/Password** — Standard account creation
2. **Strava OAuth** — Required for activity sync (can be linked after account creation)

### Auth States

```typescript
type AuthState =
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: User; stravaConnected: false }
  | { status: 'authenticated'; user: User; stravaConnected: true; stravaAthleteId: number }
```

### Registration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        REGISTRATION FLOW                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Welcome    │───▶│   Sign Up    │───▶│   Connect    │───▶│  Onboarding  │
│    Screen    │    │    Form      │    │   Strava     │    │    Flow      │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                           │                   │
                           │                   ├─── Skip (limited features)
                           │                   │
                           ▼                   ▼
                    Firebase Auth        Strava OAuth
                    createUser()         Authorization
```

**Step 1: Welcome Screen**
- App introduction with value proposition
- "Get Started" CTA → Sign Up Form
- "I have an account" link → Login Screen

**Step 2: Sign Up Form**
- Fields: Email, Password, Confirm Password
- Validation: Email format, password min 8 chars, passwords match
- On submit: `createUserWithEmailAndPassword()`
- Create user profile document in Firestore

**Step 3: Connect Strava (Required for full functionality)**
- Explain why Strava connection is needed
- "Connect with Strava" button initiates OAuth
- "Skip for now" option (user can connect later, but cannot create training plans)

**Step 4: Onboarding Flow**
- Goal configuration wizard (see Onboarding Screens section)

### Strava OAuth Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      STRAVA OAUTH FLOW                          │
└─────────────────────────────────────────────────────────────────┘

  ┌─────────┐         ┌─────────┐         ┌─────────┐         ┌─────────┐
  │  App    │         │ Strava  │         │ Cloud   │         │Firestore│
  │(Client) │         │  Auth   │         │Function │         │         │
  └────┬────┘         └────┬────┘         └────┬────┘         └────┬────┘
       │                   │                   │                   │
       │ 1. Redirect to    │                   │                   │
       │    Strava Auth    │                   │                   │
       │──────────────────▶│                   │                   │
       │                   │                   │                   │
       │ 2. User approves  │                   │                   │
       │    permissions    │                   │                   │
       │                   │                   │                   │
       │ 3. Redirect with  │                   │                   │
       │    auth code      │                   │                   │
       │◀──────────────────│                   │                   │
       │                   │                   │                   │
       │ 4. Send code to   │                   │                   │
       │    Cloud Function │                   │                   │
       │──────────────────────────────────────▶│                   │
       │                   │                   │                   │
       │                   │ 5. Exchange code  │                   │
       │                   │    for tokens     │                   │
       │                   │◀──────────────────│                   │
       │                   │                   │                   │
       │                   │ 6. Return tokens  │                   │
       │                   │──────────────────▶│                   │
       │                   │                   │                   │
       │                   │                   │ 7. Store tokens   │
       │                   │                   │    (encrypted)    │
       │                   │                   │──────────────────▶│
       │                   │                   │                   │
       │                   │                   │ 8. Register       │
       │                   │                   │    webhook        │
       │                   │◀──────────────────│                   │
       │                   │                   │                   │
       │ 9. Success        │                   │                   │
       │◀──────────────────────────────────────│                   │
       │                   │                   │                   │
```

**OAuth Configuration:**

```typescript
const STRAVA_CONFIG = {
  clientId: process.env.STRAVA_CLIENT_ID,
  redirectUri: `${APP_URL}/auth/strava/callback`,
  scope: 'read,activity:read_all,activity:write',
  authorizationUrl: 'https://www.strava.com/oauth/authorize',
  tokenUrl: 'https://www.strava.com/oauth/token',
}
```

**Requested Scopes:**
- `read` — Read public profile
- `activity:read_all` — Read all activities (including private)
- `activity:write` — Write activity descriptions (for workout export)

### Token Management

Strava tokens are stored encrypted in Firestore and refreshed automatically:

```typescript
interface StravaTokens {
  accessToken: string        // Encrypted
  refreshToken: string       // Encrypted
  expiresAt: number          // Unix timestamp
  athleteId: number
  athleteUsername: string
}
```

**Token Refresh Logic (Cloud Function):**

```typescript
async function getValidAccessToken(userId: string): Promise<string> {
  const tokens = await getStoredTokens(userId)

  if (Date.now() / 1000 > tokens.expiresAt - 300) { // 5 min buffer
    const newTokens = await refreshStravaToken(tokens.refreshToken)
    await storeTokens(userId, newTokens)
    return newTokens.accessToken
  }

  return tokens.accessToken
}
```

### Session Management

Using VueFire's `useCurrentUser()` composable for reactive auth state:

```typescript
// composables/useAuth.ts
import { computed } from 'vue'
import { useCurrentUser, useDocument } from 'vuefire'
import { doc } from 'firebase/firestore'
import { db } from '@/plugins/firebase'

export function useAuth() {
  const user = useCurrentUser()

  const userProfileRef = computed(() =>
    user.value ? doc(db, 'users', user.value.uid) : null
  )
  const { data: profile } = useDocument(userProfileRef)

  const isAuthenticated = computed(() => !!user.value)
  const stravaConnected = computed(() => !!profile.value?.stravaAthleteId)

  return {
    user,
    profile,
    isAuthenticated,
    stravaConnected,
  }
}
```

### Route Guards

```typescript
// router/index.ts
import { getCurrentUser } from 'vuefire'

const router = createRouter({
  routes: [
    {
      path: '/dashboard',
      component: DashboardPage,
      meta: { requiresAuth: true }
    },
    {
      path: '/plan/create',
      component: CreatePlanPage,
      meta: { requiresAuth: true, requiresStrava: true }
    },
    // ...
  ]
})

router.beforeEach(async (to) => {
  const user = await getCurrentUser()

  if (to.meta.requiresAuth && !user) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  if (to.meta.requiresStrava) {
    const profile = await getUserProfile(user.uid)
    if (!profile?.stravaAthleteId) {
      return { path: '/connect-strava', query: { redirect: to.fullPath } }
    }
  }
})
```

---

## Screen Specifications

### Screen Map

```
┌─────────────────────────────────────────────────────────────────┐
│                         SCREEN MAP                               │
└─────────────────────────────────────────────────────────────────┘

PUBLIC SCREENS                    AUTHENTICATED SCREENS
──────────────                    ─────────────────────

┌─────────────┐                   ┌─────────────────────────────┐
│   Welcome   │                   │         Dashboard           │
└──────┬──────┘                   │  ┌─────┬─────┬─────┬─────┐  │
       │                          │  │Today│Week │Goal │Stats│  │
       ▼                          │  └─────┴─────┴─────┴─────┘  │
┌─────────────┐                   └──────────────┬──────────────┘
│   Sign Up   │                                  │
└──────┬──────┘                   ┌──────────────┼──────────────┐
       │                          │              │              │
       ▼                          ▼              ▼              ▼
┌─────────────┐              ┌─────────┐   ┌─────────┐   ┌─────────┐
│    Login    │              │Calendar │   │Workout  │   │Progress │
└─────────────┘              │  View   │   │ Detail  │   │  View   │
                             └─────────┘   └─────────┘   └─────────┘

ONBOARDING FLOW                        │
───────────────                        ▼
                                  ┌─────────┐
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐│Settings │
│ 1  │▶│ 2  │▶│ 3  │▶│ 4  │▶│ 5  │└─────────┘
│Goal│ │Date│ │Tar-│ │Fit-│ │Sche│
│Type│ │    │ │get │ │ness│ │dule│
└────┘ └────┘ └────┘ └────┘ └────┘
```

### 1. Welcome Screen

**Route:** `/`

**Purpose:** First impression, value proposition, entry point

**Layout (Mobile-First):**
```
┌────────────────────────────────┐
│                                │
│         [App Logo]             │
│                                │
│       RunPlan Pro              │
│                                │
│   "Train smarter, not harder.  │
│    Adaptive plans that         │
│    adjust to your life."       │
│                                │
│   ┌────────────────────────┐   │
│   │     Get Started        │   │
│   └────────────────────────┘   │
│                                │
│      Already have an account?  │
│           Log in               │
│                                │
└────────────────────────────────┘
```

**Interactions:**
- "Get Started" → Navigate to `/signup`
- "Log in" → Navigate to `/login`

---

### 2. Sign Up Screen

**Route:** `/signup`

**Layout:**
```
┌────────────────────────────────┐
│ ←                              │
│                                │
│       Create Account           │
│                                │
│   ┌────────────────────────┐   │
│   │ Email                  │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │ Password               │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │ Confirm Password       │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │      Create Account    │   │
│   └────────────────────────┘   │
│                                │
│   By signing up, you agree to  │
│   our Terms and Privacy Policy │
│                                │
└────────────────────────────────┘
```

**Validation Rules:**
```typescript
const signupSchema = {
  email: {
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: 'Please enter a valid email address'
  },
  password: {
    required: true,
    minLength: 8,
    pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    message: 'Password must be at least 8 characters with uppercase, lowercase, and number'
  },
  confirmPassword: {
    required: true,
    match: 'password',
    message: 'Passwords do not match'
  }
}
```

**States:**
- Default: Form empty, button disabled
- Valid: All fields pass validation, button enabled
- Loading: Spinner on button, fields disabled
- Error: Error message displayed, relevant field highlighted

---

### 3. Login Screen

**Route:** `/login`

**Layout:**
```
┌────────────────────────────────┐
│ ←                              │
│                                │
│        Welcome Back            │
│                                │
│   ┌────────────────────────┐   │
│   │ Email                  │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │ Password           👁  │   │
│   └────────────────────────┘   │
│                                │
│              Forgot password?  │
│                                │
│   ┌────────────────────────┐   │
│   │        Log In          │   │
│   └────────────────────────┘   │
│                                │
│   ──────────  or  ──────────   │
│                                │
│   ┌────────────────────────┐   │
│   │ 🏃 Continue with Strava│   │
│   └────────────────────────┘   │
│                                │
│     Don't have an account?     │
│          Sign up               │
│                                │
└────────────────────────────────┘
```

**Error States:**
- Invalid credentials: "Email or password is incorrect"
- Too many attempts: "Too many attempts. Please try again in 5 minutes."
- Network error: "Connection failed. Please check your internet."

### 3a. Password Reset Flow

**Trigger:** User taps "Forgot password?" link on Login screen.

**Flow Diagram:**
```
┌──────────────────────────────────────────────────────────────────┐
│                       PASSWORD RESET FLOW                         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    Login     │───▶│ Reset Request│───▶│ Check Email  │───▶│    Login     │
│   Screen     │    │    Screen    │    │   Screen     │    │   Screen     │
│              │    │              │    │              │    │ (with toast) │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
 "Forgot password?"   Enter email        "Email sent"       "Password updated"
```

**Step 1: Reset Request Screen**

**Route:** `/reset-password`

**Layout:**
```
┌────────────────────────────────┐
│                                │
│   ← Back                       │
│                                │
│     🔑                          │
│                                │
│     Reset Your Password        │
│                                │
│   Enter the email address      │
│   associated with your         │
│   account and we'll send you   │
│   a link to reset your         │
│   password.                    │
│                                │
│   ┌────────────────────────┐   │
│   │ Email                  │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │     Send Reset Link    │   │
│   └────────────────────────┘   │
│                                │
│     Remember your password?    │
│          Log in                │
│                                │
└────────────────────────────────┘
```

**Behavior:**
- "Back" arrow navigates to Login screen
- Button disabled until valid email format entered
- On submit: Call `sendPasswordResetEmail(auth, email)`
- **Always show success screen** regardless of whether email exists (prevents email enumeration)
- Rate limit: Max 3 reset requests per email per hour (Firebase default)

**Error States:**
- Invalid email format: "Please enter a valid email address"
- Rate limited: "Too many requests. Please try again later."
- Network error: "Connection failed. Please check your internet."

**Validation:**
```typescript
const resetPasswordForm = {
  email: {
    required: true,
    format: 'email',
    errorMessages: {
      required: 'Email is required',
      format: 'Please enter a valid email address',
    },
  },
}
```

**Step 2: Check Email Screen**

**Route:** `/reset-password/sent`

**Layout:**
```
┌────────────────────────────────┐
│                                │
│     ✉️                          │
│                                │
│     Check Your Email           │
│                                │
│   We've sent a password        │
│   reset link to:               │
│                                │
│   user@example.com             │
│                                │
│   Click the link in the email  │
│   to reset your password.      │
│   If you don't see it, check   │
│   your spam folder.            │
│                                │
│   ┌────────────────────────┐   │
│   │     Open Email App     │   │
│   └────────────────────────┘   │
│                                │
│   Didn't receive the email?    │
│          Resend                 │
│                                │
│   ┌────────────────────────┐   │
│   │     Back to Log In     │   │
│   └────────────────────────┘   │
│                                │
└────────────────────────────────┘
```

**Behavior:**
- Shows the email address the reset link was sent to
- "Open Email App" uses `window.location.href = 'mailto:'` to open default mail client
- "Resend" triggers `sendPasswordResetEmail()` again with cooldown (60s between resends)
- Resend button shows countdown timer: "Resend (45s)"
- "Back to Log In" navigates to `/login`

**Step 3: Firebase Email Action Handler**

Firebase sends a password reset email with a link pointing to the app's action URL.

**Route:** `/__/auth/action` (Firebase default) or custom `/auth/action`

**Action handler behavior:**
```typescript
// In router or dedicated ActionHandler component
const mode = route.query.mode       // 'resetPassword'
const oobCode = route.query.oobCode // one-time code from Firebase

if (mode === 'resetPassword') {
  // Verify the code is valid
  const email = await verifyPasswordResetCode(auth, oobCode)
  // Show new password form
}
```

**New Password Screen Layout:**
```
┌────────────────────────────────┐
│                                │
│     🔐                          │
│                                │
│     Create New Password        │
│                                │
│   Enter a new password for:    │
│   user@example.com             │
│                                │
│   ┌────────────────────────┐   │
│   │ New Password       👁  │   │
│   └────────────────────────┘   │
│   Min. 8 characters            │
│                                │
│   ┌────────────────────────┐   │
│   │ Confirm Password   👁  │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │   Reset Password       │   │
│   └────────────────────────┘   │
│                                │
└────────────────────────────────┘
```

**Validation:**
```typescript
const newPasswordForm = {
  password: {
    required: true,
    minLength: 8,
    errorMessages: {
      required: 'Password is required',
      minLength: 'Password must be at least 8 characters',
    },
  },
  confirmPassword: {
    required: true,
    match: 'password',
    errorMessages: {
      required: 'Please confirm your password',
      match: 'Passwords do not match',
    },
  },
}
```

**On successful reset:**
```typescript
await confirmPasswordReset(auth, oobCode, newPassword)
// Redirect to login with success toast
router.push({ path: '/login', query: { message: 'password-reset-success' } })
```

**Error States:**
- Expired/invalid code: "This reset link has expired or already been used. Please request a new one." → Show link to `/reset-password`
- Weak password: "Password must be at least 8 characters"
- Network error: "Connection failed. Please check your internet."

---

### 4. Connect Strava Screen

**Route:** `/connect-strava`

**Layout:**
```
┌────────────────────────────────┐
│                                │
│     [Strava + App Logo]        │
│                                │
│     Connect Your Strava        │
│                                │
│   RunPlan Pro syncs with       │
│   Strava to:                   │
│                                │
│   ✓ Track your workouts        │
│     automatically              │
│                                │
│   ✓ Adjust your plan based     │
│     on real performance        │
│                                │
│   ✓ Detect missed workouts     │
│     and adapt accordingly      │
│                                │
│   ┌────────────────────────┐   │
│   │ 🏃 Connect with Strava │   │
│   └────────────────────────┘   │
│                                │
│         Skip for now           │
│   (You won't be able to create │
│    training plans)             │
│                                │
└────────────────────────────────┘
```

---

### 5. Onboarding Flow

**Routes:** `/onboarding/step-1` through `/onboarding/step-5`

#### Step 1: Goal Type

```
┌────────────────────────────────┐
│                    Step 1 of 5 │
│ ←                              │
│                                │
│     What's your goal?          │
│                                │
│   ┌────────────────────────┐   │
│   │  🏃  5K                │   │
│   └────────────────────────┘   │
│   ┌────────────────────────┐   │
│   │  🏃  10K               │   │
│   └────────────────────────┘   │
│   ┌────────────────────────┐   │
│   │  🏃  Half Marathon     │   │ ← Selected
│   └────────────────────────┘   │
│   ┌────────────────────────┐   │
│   │  🏃  Marathon          │   │
│   └────────────────────────┘   │
│   ┌────────────────────────┐   │
│   │  📏  Custom Distance   │   │
│   └────────────────────────┘   │
│                                │
│   (If Custom selected:)        │
│   ┌────────────────────────┐   │
│   │ Distance (km)    ___   │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │        Continue        │   │
│   └────────────────────────┘   │
│                                │
└────────────────────────────────┘
```

#### Step 2: Race Date

```
┌────────────────────────────────┐
│                    Step 2 of 5 │
│ ←                              │
│                                │
│     When is your race?         │
│                                │
│   ┌────────────────────────┐   │
│   │                        │   │
│   │   [Calendar Picker]    │   │
│   │                        │   │
│   └────────────────────────┘   │
│                                │
│   ○ I don't have a specific    │
│     race date yet              │
│                                │
│   Training time: 14 weeks      │
│                                │
│   ⚠️ Minimum recommended:      │
│      12 weeks for half         │
│      marathon                  │
│                                │
│   ┌────────────────────────┐   │
│   │        Continue        │   │
│   └────────────────────────┘   │
│                                │
└────────────────────────────────┘
```

**Validation:**
- Minimum weeks based on race type:
  - 5K: 6 weeks
  - 10K: 8 weeks
  - Half Marathon: 12 weeks
  - Marathon: 16 weeks
- Warning if below minimum, but allow proceeding

#### Step 3: Target Time

```
┌────────────────────────────────┐
│                    Step 3 of 5 │
│ ←                              │
│                                │
│    What's your target time?    │
│                                │
│   ┌────────────────────────┐   │
│   │                        │   │
│   │    01 : 45 : 00        │   │
│   │    HH   MM   SS        │   │
│   │                        │   │
│   └────────────────────────┘   │
│                                │
│   Based on your Strava data,   │
│   this seems achievable! 👍    │
│                                │
│   ○ I just want to finish      │
│     (no specific time goal)    │
│                                │
│   ┌────────────────────────┐   │
│   │        Continue        │   │
│   └────────────────────────┘   │
│                                │
└────────────────────────────────┘
```

**Intelligence:**
- Analyze recent Strava activities to estimate current fitness
- Provide feedback on goal feasibility:
  - "Ambitious but achievable with consistent training"
  - "Very challenging - consider a more conservative goal"
  - "You might be selling yourself short!"

#### Step 4: Current Fitness

```
┌────────────────────────────────┐
│                    Step 4 of 5 │
│ ←                              │
│                                │
│   Tell us about your current   │
│   running fitness              │
│                                │
│   Recent activity from Strava: │
│   ┌────────────────────────┐   │
│   │ Last 4 weeks:          │   │
│   │ • 12 runs              │   │
│   │ • 58 km total          │   │
│   │ • Avg pace: 5:32/km    │   │
│   └────────────────────────┘   │
│                                │
│   Recent race? (optional)      │
│   ┌──────────┐ ┌────────────┐  │
│   │ Distance │ │   Time     │  │
│   │   10K    │ │  52:30     │  │
│   └──────────┘ └────────────┘  │
│                                │
│   This helps us set accurate   │
│   training paces               │
│                                │
│   ┌────────────────────────┐   │
│   │        Continue        │   │
│   └────────────────────────┘   │
│                                │
└────────────────────────────────┘
```

#### Step 5: Schedule Preferences

```
┌────────────────────────────────┐
│                    Step 5 of 5 │
│ ←                              │
│                                │
│   When can you train?          │
│                                │
│   Select your available days:  │
│                                │
│   ┌───┬───┬───┬───┬───┬───┬───┐│
│   │ M │ T │ W │ T │ F │ S │ S ││
│   │ ✓ │   │ ✓ │   │ ✓ │ ✓ │   ││
│   └───┴───┴───┴───┴───┴───┴───┘│
│                                │
│   Preferred long run day:      │
│   ┌────────────────────────┐   │
│   │      Saturday     ▼    │   │
│   └────────────────────────┘   │
│                                │
│   Max time per session:        │
│   ┌────────────────────────┐   │
│   │      60-90 min    ▼    │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │     Create My Plan     │   │
│   └────────────────────────┘   │
│                                │
└────────────────────────────────┘
```

**Validation:**
- Minimum 3 days per week required
- Warning if long run day is also a workday (Mon-Fri)

---

### 6. Dashboard Screen

**Route:** `/dashboard`

**Layout:**
```
┌────────────────────────────────┐
│ ☰  RunPlan Pro           ⚙️ 👤│
├────────────────────────────────┤
│                                │
│  Good morning, Matus! 👋       │
│                                │
│  ┌────────────────────────┐    │
│  │ TODAY'S WORKOUT        │    │
│  │                        │    │
│  │ 🏃 Easy Run            │    │
│  │    8 km @ 5:45-6:00/km │    │
│  │                        │    │
│  │ ┌──────────────────┐   │    │
│  │ │   View Details   │   │    │
│  │ └──────────────────┘   │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │ GOAL PROGRESS          │    │
│  │                        │    │
│  │ Half Marathon          │    │
│  │ March 15, 2026         │    │
│  │                        │    │
│  │ ████████░░░░  68%      │    │
│  │                        │    │
│  │ 6 weeks remaining      │    │
│  │ On track for 1:44:30   │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │ THIS WEEK              │    │
│  │                        │    │
│  │ 3/4 workouts complete  │    │
│  │ 32/42 km               │    │
│  │                        │    │
│  │ M  T  W  T  F  S  S    │    │
│  │ ✓  ·  ✓  ·  ✓  ○  ·    │    │
│  └────────────────────────┘    │
│                                │
├────────────────────────────────┤
│  🏠    📅    📊    ⚙️         │
│ Home  Cal  Stats  Settings    │
└────────────────────────────────┘
```

**Legend:**
- ✓ = Completed
- ○ = Scheduled (today or future)
- · = Rest day
- ✗ = Missed

**Interactions:**
- Tap workout card → Workout Detail
- Tap "View Details" → Workout Detail
- Tap progress card → Progress View
- Tap week summary → Calendar View
- Bottom nav → respective screens

**Screen States:**

| State | Trigger | Display |
|-------|---------|---------|
| **Loading** | Initial data fetch | Skeleton placeholders for workout card, goal card, and week summary. Bottom nav visible. |
| **No Active Goal** | User has no goal or hasn't completed onboarding | Illustration + "Set Your First Goal" CTA button → navigates to onboarding. Week summary hidden. |
| **No Workout Today** | Active goal exists but today is a rest day | Workout card replaced with: "Rest Day — Enjoy your recovery! 😴". Goal card and week summary shown normally. |
| **All Workouts Complete** | All scheduled workouts for the week are done | Week summary shows "All done! 🎉" badge. Workout card shows next upcoming workout with label "Next up: [day]". |
| **Strava Not Connected** | User hasn't linked Strava | Banner above workout card: "Connect Strava to track workouts automatically" with "Connect" action → `/connect-strava`. |
| **Error** | Network failure or Firestore error | Error card with message "Couldn't load your data" + "Retry" button. Cached data shown if available (stale-while-revalidate). |
| **Offline** | No network detected | Top banner: "You're offline — showing cached data". Data from last successful fetch displayed. |

---

### 7. Calendar Screen

**Route:** `/calendar`

**Layout:**
```
┌────────────────────────────────┐
│ ←  Training Calendar      🔍   │
├────────────────────────────────┤
│                                │
│  ◀  January 2026  ▶            │
│                                │
│  M   T   W   T   F   S   S     │
│ ┌───┬───┬───┬───┬───┬───┬───┐  │
│ │   │   │ 1 │ 2 │ 3 │ 4 │ 5 │  │
│ │   │   │ · │ · │ · │ · │ · │  │
│ ├───┼───┼───┼───┼───┼───┼───┤  │
│ │ 6 │ 7 │ 8 │ 9 │10 │11 │12 │  │
│ │ E │ · │ T │ · │ E │ L │ · │  │
│ │ ✓ │   │ ✓ │   │ ✓ │ ✓ │   │  │
│ ├───┼───┼───┼───┼───┼───┼───┤  │
│ │13 │14 │15 │16 │17 │18 │19 │  │
│ │ E │ · │ I │ · │ E │ L │ · │  │
│ │ ✓ │   │ ✓ │   │ ✗ │ ✓ │   │  │
│ ├───┼───┼───┼───┼───┼───┼───┤  │
│ │20 │21 │22 │23 │24 │25 │26 │  │
│ │ E │ · │ T │ · │ E │ L │ · │  │
│ │ ○ │   │ ○ │   │ ○ │ ○ │   │  │
│ └───┴───┴───┴───┴───┴───┴───┘  │
│                                │
│  Legend:                       │
│  E=Easy  T=Tempo  I=Intervals  │
│  L=Long  R=Recovery            │
│                                │
├────────────────────────────────┤
│  ┌────────────────────────┐    │
│  │ SELECTED: Jan 22       │    │
│  │                        │    │
│  │ 🏃 Tempo Run           │    │
│  │    10 km               │    │
│  │    5:15-5:25/km        │    │
│  │                        │    │
│  │      View Details  ▶   │    │
│  └────────────────────────┘    │
│                                │
├────────────────────────────────┤
│  🏠    📅    📊    ⚙️         │
└────────────────────────────────┘
```

**Interactions:**
- Tap date → Show workout summary below calendar
- Tap "View Details" → Workout Detail screen
- Swipe left/right → Change month
- Pinch → Toggle week/month view

**Screen States:**

| State | Trigger | Display |
|-------|---------|---------|
| **Loading** | Initial data fetch or month change | Calendar grid skeleton (7×5 cells). Bottom detail panel hidden. |
| **No Active Goal** | No goal exists | Empty calendar with message: "Create a training plan to see your schedule here." + "Get Started" CTA → onboarding. |
| **No Workout on Date** | User taps a rest day | Detail panel shows: "Rest day — no workout scheduled." |
| **Past Month (no data)** | Browsing to a month before plan start | Calendar shown with no workout indicators. Small note: "Plan started on [date]." |
| **Error** | Failed to load workouts for month | Calendar grid shown empty with inline error: "Couldn't load workouts. Tap to retry." |
| **Offline** | No network | Top banner: "You're offline — showing cached data." Cached workouts displayed, months with no cache show empty. |

---

### 8. Workout Detail Screen

**Route:** `/workout/:id`

**Layout (Scheduled):**
```
┌────────────────────────────────┐
│ ←  Wednesday, Jan 22           │
├────────────────────────────────┤
│                                │
│        🏃                      │
│     Tempo Run                  │
│                                │
│  ┌────────────────────────┐    │
│  │ TARGETS                │    │
│  │                        │    │
│  │ Distance    10 km      │    │
│  │ Duration    ~52 min    │    │
│  │ Pace        5:15-5:25  │    │
│  │ Heart Rate  Z3-Z4      │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │ WORKOUT STRUCTURE      │    │
│  │                        │    │
│  │ 1. Warm-up    2 km     │    │
│  │    Easy pace           │    │
│  │                        │    │
│  │ 2. Main set   6 km     │    │
│  │    Tempo pace          │    │
│  │    5:15-5:25/km        │    │
│  │                        │    │
│  │ 3. Cool-down  2 km     │    │
│  │    Easy pace           │    │
│  │                        │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │ WHY THIS WORKOUT?      │    │
│  │                        │    │
│  │ Tempo runs improve     │    │
│  │ your lactate threshold,│    │
│  │ helping you maintain   │    │
│  │ faster paces longer.   │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │  📤 Export to Strava   │    │
│  └────────────────────────┘    │
│                                │
│  Can't do this workout?        │
│  Mark as skipped               │
│                                │
└────────────────────────────────┘
```

**Layout (Completed):**
```
┌────────────────────────────────┐
│ ←  Monday, Jan 20        ✓     │
├────────────────────────────────┤
│                                │
│        🏃                      │
│     Easy Run                   │
│     Completed!                 │
│                                │
│  ┌─────────────┬─────────────┐ │
│  │   PLANNED   │   ACTUAL    │ │
│  ├─────────────┼─────────────┤ │
│  │ 8 km        │ 8.2 km   ✓  │ │
│  │ 5:45-6:00   │ 5:52/km  ✓  │ │
│  │ ~48 min     │ 48:12    ✓  │ │
│  │ Z2          │ 142 bpm  ✓  │ │
│  └─────────────┴─────────────┘ │
│                                │
│  ┌────────────────────────┐    │
│  │ PERFORMANCE SCORE      │    │
│  │                        │    │
│  │      ⭐ 95/100         │    │
│  │                        │    │
│  │ Great job staying in   │    │
│  │ the easy zone!         │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │ 🔗 View on Strava      │    │
│  └────────────────────────┘    │
│                                │
└────────────────────────────────┘
```

**Screen States:**

| State | Trigger | Display |
|-------|---------|---------|
| **Loading** | Navigating to workout detail | Skeleton placeholders for targets table, workout structure, and performance section. |
| **Scheduled (future)** | Workout date is in the future | Default layout (Scheduled) with targets, structure, explanation. "Export to Strava" and "Mark as skipped" actions visible. |
| **Completed** | Activity matched to this workout | Completed layout with planned vs. actual comparison, performance score, and Strava link. |
| **Missed** | Workout date passed with no matching activity and no manual skip | Header shows "Missed" badge (red). Targets still shown. Message: "This workout was not completed. Your plan has been adjusted." |
| **Skipped** | User manually marked as skipped | Header shows "Skipped" badge (gray). Targets still shown. Message: "You chose to skip this workout." + optional: "Reason: [user's reason]" if provided. |
| **Workout Not Found** | Invalid workout ID in route | Full-screen message: "Workout not found." + "Back to Calendar" button. |
| **Error** | Failed to load workout data | Full-screen error: "Couldn't load workout details." + "Retry" button. |

---

### 9. Progress Screen

**Route:** `/progress`

**Layout:**
```
┌────────────────────────────────┐
│ ←  Progress                    │
├────────────────────────────────┤
│                                │
│  ┌────────────────────────┐    │
│  │ PREDICTED FINISH TIME  │    │
│  │                        │    │
│  │      1:44:30           │    │
│  │                        │    │
│  │ Target: 1:45:00        │    │
│  │ You're 30 sec ahead! 🎉│    │
│  └────────────────────────┘    │
│                                │
│  Weekly Volume                 │
│  ┌────────────────────────┐    │
│  │     📊                 │    │
│  │  45├──────────█        │    │
│  │    │      █   █   █    │    │
│  │  30├──█   █   █   █    │    │
│  │    │  █   █   █   █    │    │
│  │  15├──█───█───█───█────│    │
│  │    │  █   █   █   █    │    │
│  │   0└──────────────────│    │
│  │    W1  W2  W3  W4  W5  │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │ STATS                  │    │
│  │                        │    │
│  │ Total Distance  142 km │    │
│  │ Total Time      14h 22m│    │
│  │ Workouts Done   18/24  │    │
│  │ Compliance      75%    │    │
│  │ Current Streak  5 days │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │ PACE TREND             │    │
│  │                        │    │
│  │ Easy Pace    5:48 → 5:42│   │
│  │ Tempo Pace   5:20 → 5:12│   │
│  │              ↑ Improving│   │
│  └────────────────────────┘    │
│                                │
├────────────────────────────────┤
│  🏠    📅    📊    ⚙️         │
└────────────────────────────────┘
```

**Screen States:**

| State | Trigger | Display |
|-------|---------|---------|
| **Loading** | Initial data fetch | Skeleton placeholders for prediction card, volume chart, stats, and pace trend. |
| **No Active Goal** | No goal exists | Full-screen empty state: illustration + "Start a training plan to track your progress." + "Get Started" CTA. |
| **Insufficient Data** | Goal exists but < 1 week of data | Prediction card shows "Not enough data yet — complete a few workouts to see predictions." Volume chart and stats shown with available data. Pace trend hidden. |
| **Goal Completed** | Goal status is 'completed' | Prediction card replaced with final results summary. All historical charts and stats shown. |
| **Error** | Failed to load progress data | Full-screen error: "Couldn't load progress data." + "Retry" button. |
| **Offline** | No network | Top banner: "You're offline — showing cached data." Last fetched data displayed. |

---

### 10. Settings Screen

**Route:** `/settings`

**Layout:**
```
┌────────────────────────────────┐
│ ←  Settings                    │
├────────────────────────────────┤
│                                │
│  ACCOUNT                       │
│  ┌────────────────────────┐    │
│  │ 👤 Profile           ▶ │    │
│  ├────────────────────────┤    │
│  │ 🏃 Strava Connection   │    │
│  │    Connected as @matus │    │
│  │    Disconnect          │    │
│  └────────────────────────┘    │
│                                │
│  TRAINING                      │
│  ┌────────────────────────┐    │
│  │ 🎯 Current Goal      ▶ │    │
│  │    Half Marathon       │    │
│  ├────────────────────────┤    │
│  │ 📅 Schedule          ▶ │    │
│  │    Mon, Wed, Fri, Sat  │    │
│  ├────────────────────────┤    │
│  │ 📏 Units               │    │
│  │    Kilometers     ○ ●  │    │
│  └────────────────────────┘    │
│                                │
│  NOTIFICATIONS                 │
│  ┌────────────────────────┐    │
│  │ Workout Reminders  ○ ● │    │
│  │ Plan Adjustments   ○ ● │    │
│  │ Weekly Summary     ● ○ │    │
│  └────────────────────────┘    │
│                                │
│  SUPPORT                       │
│  ┌────────────────────────┐    │
│  │ ❓ Help & FAQ        ▶ │    │
│  ├────────────────────────┤    │
│  │ 📧 Contact Support   ▶ │    │
│  ├────────────────────────┤    │
│  │ ⭐ Rate the App      ▶ │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │       Log Out          │    │
│  └────────────────────────┘    │
│                                │
│  Version 1.0.0                 │
│                                │
└────────────────────────────────┘
```

---

### 11. Plan Adjustment Modal

**Triggered by:** Missed workout detection, performance anomaly

**Layout:**
```
┌────────────────────────────────┐
│                                │
│  ┌────────────────────────┐    │
│  │                        │    │
│  │    Plan Adjusted 🔄    │    │
│  │                        │    │
│  │  We noticed you missed │    │
│  │  Friday's tempo run.   │    │
│  │                        │    │
│  │  Here's what changed:  │    │
│  │                        │    │
│  │  • Saturday's long run │    │
│  │    shortened: 18km→15km│    │
│  │                        │    │
│  │  • Tempo rescheduled   │    │
│  │    to Tuesday          │    │
│  │                        │    │
│  │  • Easy run added      │    │
│  │    Monday for recovery │    │
│  │                        │    │
│  │  Your goal is still    │    │
│  │  achievable! 💪        │    │
│  │                        │    │
│  │  ┌──────────────────┐  │    │
│  │  │   Sounds Good    │  │    │
│  │  └──────────────────┘  │    │
│  │                        │    │
│  │     View Full Plan     │    │
│  │                        │    │
│  └────────────────────────┘    │
│                                │
└────────────────────────────────┘
```

---

## Feature Interactions

### Workout Completion Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   WORKOUT COMPLETION FLOW                        │
└─────────────────────────────────────────────────────────────────┘

User completes          Strava sends           Cloud Function
run on Strava           webhook event          processes
     │                       │                      │
     ▼                       ▼                      ▼
┌─────────┐            ┌─────────┐            ┌─────────┐
│ Strava  │───────────▶│ Webhook │───────────▶│ Match   │
│  App    │  activity  │ Receiver│  event     │ Engine  │
└─────────┘  .create   └─────────┘  queued    └────┬────┘
                                                   │
                       ┌───────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │ Is there a     │
              │ scheduled      │──── No ───▶ Store as unplanned
              │ workout today? │             activity
              └───────┬────────┘
                      │ Yes
                      ▼
              ┌────────────────┐
              │ Match activity │
              │ to workout     │
              │ (time window,  │
              │ type, distance)│
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────┐
              │ Calculate      │
              │ performance    │
              │ score          │
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────┐
              │ Update workout │
              │ status =       │
              │ 'completed'    │
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────┐
              │ Check if plan  │──── Yes ───▶ Trigger adaptive
              │ adjustment     │              replanning
              │ needed?        │
              └───────┬────────┘
                      │ No
                      ▼
              ┌────────────────┐
              │ Send push      │
              │ notification   │
              │ (if enabled)   │
              └────────────────┘
```

### Missed Workout Detection

```typescript
// Scheduled Cloud Function: runs every hour
async function checkMissedWorkouts() {
  const now = new Date()
  const cutoffTime = subHours(now, 6) // 6 hours after scheduled time

  const missedWorkouts = await db.collectionGroup('workouts')
    .where('status', '==', 'scheduled')
    .where('date', '<', cutoffTime)
    .get()

  for (const workout of missedWorkouts.docs) {
    const workoutData = workout.data()

    // Check if activity was logged but not matched
    const possibleMatch = await findUnmatchedActivity(
      workoutData.userId,
      workoutData.date,
      workoutData.type
    )

    if (possibleMatch) {
      await matchWorkoutToActivity(workout.id, possibleMatch.id)
    } else {
      await markWorkoutMissed(workout.id)
      await triggerAdaptivePlanning(workoutData.userId, workoutData.goalId)
    }
  }
}
```

### Adaptive Replanning Logic

```typescript
interface ReplanningContext {
  missedWorkout: ScheduledWorkout
  reason?: 'illness' | 'injury' | 'schedule' | 'fatigue' | 'unknown'
  recentCompliance: number  // % of workouts completed in last 2 weeks
  daysUntilRace: number
  currentPhase: 'base' | 'build' | 'peak' | 'taper'
}

async function adaptPlan(context: ReplanningContext): Promise<PlanAdjustment> {
  const { missedWorkout, reason, recentCompliance, daysUntilRace, currentPhase } = context

  // Rule 1: Illness/Injury = conservative approach
  if (reason === 'illness' || reason === 'injury') {
    return {
      changes: [
        { action: 'cancel', workoutId: missedWorkout.id },
        { action: 'reduce_volume', weeks: 1, percentage: 30 },
        { action: 'add_recovery', days: 2 }
      ],
      message: 'Take it easy and focus on recovery. We\'ve reduced your training load.'
    }
  }

  // Rule 2: Key workout missed = try to reschedule
  if (isKeyWorkout(missedWorkout)) {
    const rescheduleSlot = findRescheduleSlot(missedWorkout, 72) // within 72 hours

    if (rescheduleSlot) {
      return {
        changes: [
          { action: 'reschedule', workoutId: missedWorkout.id, newDate: rescheduleSlot },
          { action: 'swap', workoutId: rescheduleSlot.existingWorkoutId, newType: 'easy' }
        ],
        message: `We've rescheduled your ${missedWorkout.type} run to ${formatDate(rescheduleSlot)}.`
      }
    }
  }

  // Rule 3: Low compliance = reduce volume
  if (recentCompliance < 0.6) {
    return {
      changes: [
        { action: 'reduce_volume', weeks: 2, percentage: 20 },
        { action: 'simplify', removeIntervals: true }
      ],
      message: 'We\'ve simplified your plan to help you build consistency.'
    }
  }

  // Rule 4: Taper phase = don't add anything back
  if (currentPhase === 'taper') {
    return {
      changes: [
        { action: 'absorb', workoutId: missedWorkout.id }
      ],
      message: 'No worries - extra rest during taper is fine!'
    }
  }

  // Default: absorb the loss, minor adjustments
  return {
    changes: [
      { action: 'absorb', workoutId: missedWorkout.id },
      { action: 'extend_next_long_run', additionalKm: 2 }
    ],
    message: 'We\'ve made minor adjustments to keep you on track.'
  }
}
```

### Goal Completion & Abandonment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              GOAL LIFECYCLE STATE TRANSITIONS                     │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │    active    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │ Race date  │ │ User taps  │ │ User taps  │
     │ reached    │ │ "Complete" │ │ "Abandon"  │
     └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
           │               │              │
           ▼               ▼              ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │ completed  │ │ completed  │ │ abandoned  │
     │ (auto)     │ │ (manual)   │ │            │
     └────────────┘ └────────────┘ └────────────┘
```

#### Auto-Completion (Race Date Reached)

**Trigger:** Scheduled Cloud Function detects goal race date has passed.

```typescript
// Cloud Function: runs daily at 06:00 UTC
async function checkGoalCompletion() {
  const today = startOfDay(new Date())

  const dueGoals = await db.collectionGroup('goals')
    .where('status', '==', 'active')
    .where('raceDate', '<', today)
    .get()

  for (const goalDoc of dueGoals.docs) {
    const goal = goalDoc.data()

    // Check if race activity was logged (within ±1 day of race date)
    const raceActivity = await findRaceActivity(goal.userId, goal.raceDate, goal.raceType)

    await goalDoc.ref.update({
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      completionType: raceActivity ? 'raced' : 'date_reached',
      raceResult: raceActivity ? {
        finishTime: raceActivity.movingTime,
        activityId: raceActivity.stravaId,
        distance: raceActivity.distance,
      } : null,
    })

    // Send completion notification
    await sendNotification(goal.userId, {
      type: 'goal_completed',
      title: raceActivity ? 'Race Complete! 🏁' : 'Training Plan Complete!',
      body: raceActivity
        ? `You finished your ${goal.raceType} in ${formatTime(raceActivity.movingTime)}!`
        : `Your ${goal.raceType} training plan is complete. How did it go?`,
    })
  }
}
```

#### Manual Completion (User Action)

**Access:** Settings → Current Goal → "Mark as Complete"

**Confirmation Dialog:**
```
┌────────────────────────────────┐
│                                │
│   Complete This Goal?          │
│                                │
│   Marking your Half Marathon   │
│   goal as complete will end    │
│   your current training plan.  │
│                                │
│   You can start a new goal     │
│   afterwards.                  │
│                                │
│   ┌────────────────────────┐   │
│   │   Yes, Complete Goal   │   │
│   └────────────────────────┘   │
│                                │
│          Cancel                │
│                                │
└────────────────────────────────┘
```

**On confirm:**
```typescript
async function completeGoal(userId: string, goalId: string) {
  await db.doc(`users/${userId}/goals/${goalId}`).update({
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
    completionType: 'manual',
  })

  // Navigate to Goal Summary screen
  router.push(`/goal/${goalId}/summary`)
}
```

#### Goal Abandonment (User Action)

**Access:** Settings → Current Goal → "Abandon Goal"

**Confirmation Dialog:**
```
┌────────────────────────────────┐
│                                │
│   Abandon This Goal?           │
│                                │
│   This will stop your current  │
│   Half Marathon training plan. │
│   Your workout history will    │
│   be preserved.                │
│                                │
│   Reason (optional):           │
│   ┌────────────────────────┐   │
│   │ Select reason...     ▼ │   │
│   └────────────────────────┘   │
│   • Changed my mind            │
│   • Injury                     │
│   • Schedule conflict          │
│   • Too difficult              │
│   • Other                      │
│                                │
│   ┌────────────────────────┐   │
│   │   Abandon Goal         │   │
│   └────────────────────────┘   │
│   (destructive/red button)     │
│                                │
│          Keep Training         │
│                                │
└────────────────────────────────┘
```

**On confirm:**
```typescript
async function abandonGoal(userId: string, goalId: string, reason?: string) {
  await db.doc(`users/${userId}/goals/${goalId}`).update({
    status: 'abandoned',
    abandonedAt: FieldValue.serverTimestamp(),
    abandonReason: reason ?? null,
  })

  // Cancel all future scheduled workouts
  const futureWorkouts = await db
    .collection(`users/${userId}/goals/${goalId}/workouts`)
    .where('status', '==', 'scheduled')
    .where('date', '>=', new Date())
    .get()

  const batch = db.batch()
  futureWorkouts.docs.forEach(doc => {
    batch.update(doc.ref, { status: 'cancelled' })
  })
  await batch.commit()

  // Navigate to Dashboard (empty goal state)
  router.push('/dashboard')
}
```

#### Goal Summary Screen

**Route:** `/goal/:id/summary`

**Shown after:** Goal completion (auto or manual).

**Layout:**
```
┌────────────────────────────────┐
│                                │
│     🏅                          │
│                                │
│   Training Complete!           │
│   Half Marathon                │
│                                │
│  ┌────────────────────────┐    │
│  │ SUMMARY                │    │
│  │                        │    │
│  │ Duration    12 weeks   │    │
│  │ Workouts    36 / 48    │    │
│  │ Compliance  75%        │    │
│  │ Total km    485 km     │    │
│  │ Total time  48h 12m    │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │ RACE RESULT            │    │
│  │                        │    │
│  │ Finish time  1:43:22   │    │
│  │ Target       1:45:00   │    │
│  │ Prediction   1:44:30   │    │
│  │                        │    │
│  │ 🎉 1:38 ahead of       │    │
│  │    your target!         │    │
│  └────────────────────────┘    │
│                                │
│  ┌────────────────────────┐    │
│  │  Start New Goal         │    │
│  └────────────────────────┘    │
│                                │
│      View Training History     │
│                                │
└────────────────────────────────┘
```

**Notes:**
- "Race Result" card only shown if race activity was detected
- If no race detected, show prompt: "Did you race? Add your result manually."
- "Start New Goal" → Navigates to onboarding Step 1 (goal selection)
- "View Training History" → Calendar view filtered to this goal's date range

#### Post-Goal State

After goal completion or abandonment, the user returns to a "no active goal" state:
- **Dashboard:** Shows "No Active Goal" empty state (see Dashboard Screen States)
- **Calendar:** Shows historical data from completed/abandoned goal, no future workouts
- **Progress:** Shows final summary for last goal
- **Settings → Current Goal:** Shows "Set New Goal" button instead of current goal details

---

## Backend API

### API Overview

The backend consists of Firebase Cloud Functions exposed as HTTP endpoints and Firestore triggers.

**Base URL:** `https://us-central1-runplan-pro.cloudfunctions.net/api`

### Authentication Endpoints

#### POST `/auth/strava/callback`

Exchange Strava authorization code for tokens.

**Request:**
```typescript
{
  code: string           // Authorization code from Strava
  userId: string         // Firebase user ID
}
```

**Response:**
```typescript
{
  success: boolean
  athlete: {
    id: number
    username: string
    firstname: string
    lastname: string
  }
}
```

**Errors:**
- `400` - Missing code or userId
- `401` - Invalid authorization code
- `500` - Token exchange failed

#### POST `/auth/strava/disconnect`

Disconnect Strava account.

**Request:**
```typescript
{
  userId: string
}
```

**Response:**
```typescript
{
  success: boolean
}
```

---

### Plan Endpoints

#### POST `/plan/generate`

Generate a new training plan.

**Request:**
```typescript
{
  userId: string
  goal: {
    raceType: '5k' | '10k' | 'half' | 'marathon' | 'custom'
    raceDate: string              // ISO date
    raceDistance?: number          // meters (required if raceType is 'custom')
    targetTime?: number           // seconds
    justFinish: boolean
  }
  fitness: {
    recentRaceDistance?: number   // meters
    recentRaceTime?: number       // seconds
    weeklyVolume?: number         // km
  }
  schedule: {
    availableDays: number[]       // 0=Sun, 1=Mon, etc.
    longRunDay: number
    maxSessionMinutes: number
  }
}
```

**Response:**
```typescript
{
  success: boolean
  goalId: string
  plan: {
    weeks: number
    totalWorkouts: number
    weeklyPeakVolume: number
    phases: Array<{
      name: string
      weeks: number
      focus: string
    }>
  }
}
```

#### GET `/plan/:goalId`

Get full training plan details.

**Response:**
```typescript
{
  goal: Goal
  workouts: ScheduledWorkout[]
  stats: {
    completedCount: number
    missedCount: number
    complianceRate: number
    currentWeek: number
    totalWeeks: number
  }
}
```

#### POST `/plan/:goalId/adjust`

Manually request plan adjustment.

**Request:**
```typescript
{
  reason: 'illness' | 'injury' | 'schedule_change' | 'goal_change'
  details?: string
  newTargetTime?: number
  newRaceDate?: string
  newAvailableDays?: number[]
}
```

**Response:**
```typescript
{
  success: boolean
  adjustmentId: string
  changes: PlanChange[]
  message: string
}
```

---

### Workout Endpoints

#### GET `/workouts/upcoming`

Get upcoming workouts (next 7 days).

**Query params:**
- `userId` (required)
- `goalId` (optional)

**Response:**
```typescript
{
  workouts: Array<{
    id: string
    date: string
    type: WorkoutType
    status: WorkoutStatus
    distance: number
    targetPace: { min: number; max: number }
    structure: WorkoutStructure[]
  }>
}
```

#### GET `/workouts/:workoutId`

Get workout details.

**Response:**
```typescript
{
  workout: ScheduledWorkout
  matchedActivity?: CompletedActivity
  performance?: {
    score: number
    paceCompliance: number
    distanceCompliance: number
    feedback: string
  }
}
```

#### POST `/workouts/:workoutId/skip`

Mark workout as intentionally skipped.

**Request:**
```typescript
{
  reason?: string
}
```

**Response:**
```typescript
{
  success: boolean
  planAdjusted: boolean
  adjustmentId?: string
}
```

#### POST `/workouts/:workoutId/export`

Export workout to Strava (creates planned activity description).

**Response:**
```typescript
{
  success: boolean
  stravaDescription: string
}
```

---

### Strava Webhook Endpoints

#### GET `/strava/webhook`

Webhook verification (called by Strava during subscription setup).

**Query params:**
- `hub.mode` = 'subscribe'
- `hub.challenge` = random string
- `hub.verify_token` = our verification token

**Response:**
```typescript
{
  "hub.challenge": string  // Echo back the challenge
}
```

#### POST `/strava/webhook`

Receive activity events from Strava.

**Request (from Strava):**
```typescript
{
  object_type: 'activity' | 'athlete'
  object_id: number
  aspect_type: 'create' | 'update' | 'delete'
  owner_id: number        // Strava athlete ID
  subscription_id: number
  event_time: number      // Unix timestamp
  updates?: {             // Only for 'update' events
    title?: string
    type?: string
    private?: boolean
  }
}
```

**Response:**
```typescript
// Always return 200 quickly, process async
{ received: true }
```

---

### Analytics Endpoints

#### GET `/analytics/progress`

Get progress analytics for a goal.

**Query params:**
- `userId` (required)
- `goalId` (required)

**Response:**
```typescript
{
  predictedFinishTime: number
  confidence: number
  weeklyVolumes: Array<{
    week: number
    planned: number
    actual: number
  }>
  paceProgress: {
    easy: { start: number; current: number }
    tempo: { start: number; current: number }
    interval: { start: number; current: number }
  }
  compliance: {
    overall: number
    byWeek: number[]
    byType: Record<WorkoutType, number>
  }
}
```

#### GET `/analytics/activity-history`

Get activity history from Strava.

**Query params:**
- `userId` (required)
- `startDate` (optional)
- `endDate` (optional)
- `limit` (optional, default 50)

**Response:**
```typescript
{
  activities: Array<{
    id: string
    stravaId: number
    date: string
    type: string
    distance: number
    duration: number
    pace: number
    heartRate?: number
    matched: boolean
    workoutId?: string
  }>
}
```

---

## Firestore Data Schema

### Collections Structure

```
firestore/
│
├── users/
│   └── {userId}/
│       ├── profile: UserProfile
│       ├── settings: UserSettings
│       ├── stravaTokens: StravaTokens (encrypted)
│       │
│       ├── goals/ (subcollection)
│       │   └── {goalId}/
│       │       ├── details: Goal
│       │       │
│       │       ├── workouts/ (subcollection)
│       │       │   └── {workoutId}: ScheduledWorkout
│       │       │
│       │       └── adjustments/ (subcollection)
│       │           └── {adjustmentId}: PlanAdjustment
│       │
│       └── activities/ (subcollection)
│           └── {activityId}: CompletedActivity
│
└── webhookSubscriptions/
    └── {subscriptionId}: WebhookSubscription
```

### Document Schemas

#### UserProfile

```typescript
interface UserProfile {
  email: string
  displayName?: string
  photoURL?: string
  stravaAthleteId?: number
  stravaUsername?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### UserSettings

```typescript
interface UserSettings {
  units: 'metric' | 'imperial'
  notifications: {
    workoutReminders: boolean
    reminderTime: string          // "07:00"
    planAdjustments: boolean
    weeklySummary: boolean
  }
  timezone: string                // "Europe/Prague"
}
```

#### Goal

```typescript
interface Goal {
  id: string
  userId: string

  // Goal definition
  raceType: '5k' | '10k' | 'half' | 'marathon' | 'custom'
  raceDistance?: number           // For custom only
  raceDate: Timestamp
  raceName?: string
  targetTime?: number             // seconds
  justFinish: boolean

  // Plan metadata
  planGeneratedAt: Timestamp
  planVersion: number
  totalWeeks: number
  currentWeek: number
  currentPhase: 'base' | 'build' | 'peak' | 'taper'

  // Schedule
  trainingDays: number[]          // 0=Sun, 1=Mon...
  longRunDay: number
  maxSessionMinutes: number

  // Fitness baseline
  baselinePace: {
    easy: number                  // sec/km
    tempo: number
    interval: number
  }
  estimatedVDOT?: number

  // Status
  status: 'active' | 'completed' | 'abandoned'
  completedAt?: Timestamp
  completionType?: 'raced' | 'date_reached' | 'manual'
  abandonedAt?: Timestamp
  abandonReason?: 'changed_mind' | 'injury' | 'schedule_conflict' | 'too_difficult' | 'other'
  raceResult?: {
    finishTime: number            // seconds
    activityId: string
    distance: number              // meters
  }

  // Timestamps
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### ScheduledWorkout

```typescript
interface ScheduledWorkout {
  id: string
  goalId: string
  userId: string

  // Schedule
  date: Timestamp
  week: number
  dayOfWeek: number
  phase: 'base' | 'build' | 'peak' | 'taper'

  // Workout spec
  type: 'easy' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'race'
  title: string
  description: string

  // Targets
  plannedDistance: number         // meters
  plannedDuration?: number        // seconds
  targetPace?: {
    min: number                   // sec/km
    max: number
  }
  targetHeartRateZone?: number    // 1-5

  // Structured workout
  structure?: Array<{
    type: 'warmup' | 'main' | 'cooldown' | 'interval' | 'recovery'
    distance?: number
    duration?: number
    pace?: { min: number; max: number }
    repeats?: number
  }>

  // Status
  status: 'scheduled' | 'completed' | 'missed' | 'skipped' | 'cancelled'
  matchedActivityId?: string

  // Adaptation
  isAdapted: boolean
  adaptedFrom?: string            // Original workout ID
  adaptationReason?: string

  // Performance (populated after completion)
  performance?: {
    score: number                 // 0-100
    actualDistance: number
    actualDuration: number
    actualPace: number
    paceCompliance: number        // 0-1
    feedback: string
  }

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### CompletedActivity

```typescript
interface CompletedActivity {
  id: string
  userId: string
  stravaId: number

  // Activity data
  type: string                    // 'Run', 'TrailRun', etc.
  name: string
  description?: string
  startTime: Timestamp

  // Metrics
  distance: number                // meters
  duration: number                // seconds (moving time)
  elapsedTime: number             // seconds (total)
  averagePace: number             // sec/km
  maxPace?: number
  averageHeartRate?: number
  maxHeartRate?: number
  elevationGain?: number
  calories?: number

  // Matching
  matchedWorkoutId?: string
  matchedGoalId?: string
  matchConfidence?: number        // 0-1

  // Strava metadata
  stravaGearId?: string
  isPrivate: boolean
  hasHeartRate: boolean

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### PlanAdjustment

```typescript
interface PlanAdjustment {
  id: string
  goalId: string
  userId: string

  // Trigger
  triggeredBy: 'missed_workout' | 'performance' | 'user_request' | 'illness' | 'injury' | 'schedule_change'
  triggerWorkoutId?: string

  // Changes
  changes: Array<{
    action: 'reschedule' | 'cancel' | 'modify' | 'add' | 'reduce_volume' | 'absorb'
    workoutId?: string
    details: Record<string, any>
  }>

  // Communication
  title: string
  message: string

  // User response
  acknowledged: boolean
  acknowledgedAt?: Timestamp
  userFeedback?: 'accepted' | 'rejected' | 'modified'

  createdAt: Timestamp
}
```

### Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can only access their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /goals/{goalId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;

        match /workouts/{workoutId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }

        match /adjustments/{adjustmentId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }

      match /activities/{activityId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      // Tokens are only accessible by Cloud Functions (admin SDK)
      match /stravaTokens {
        allow read, write: if false;
      }
    }

    // Webhook subscriptions - admin only
    match /webhookSubscriptions/{subscriptionId} {
      allow read, write: if false;
    }
  }
}
```

### Firestore Composite Indexes

Composite indexes are required for queries that filter or sort on multiple fields. These must be defined in `firestore.indexes.json`.

```json
{
  "indexes": [
    {
      "collectionGroup": "workouts",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "goals",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "raceDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workouts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workouts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "date", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "activities",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "startDate", "order": "DESCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workouts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "week", "order": "ASCENDING" },
        { "fieldPath": "dayOfWeek", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workouts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "phase", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

**Index explanations:**

| # | Collection | Scope | Fields | Used By |
|---|-----------|-------|--------|---------|
| 1 | `workouts` | Collection Group | `status` + `date` | `checkMissedWorkouts()` — finds overdue scheduled workouts across all users |
| 2 | `goals` | Collection Group | `status` + `raceDate` | `checkGoalCompletion()` — finds active goals past their race date |
| 3 | `workouts` | Collection | `status` + `date` | `abandonGoal()` — cancels future scheduled workouts for a specific goal |
| 4 | `workouts` | Collection | `date` + `type` | Activity matching — finds candidate workouts by date and type |
| 5 | `activities` | Collection | `startDate` + `type` | Activity listing, race detection — filters activities by date and type |
| 6 | `workouts` | Collection | `week` + `dayOfWeek` | Calendar view — orders workouts within a training week |
| 7 | `workouts` | Collection | `phase` + `date` | Progress view — filters workouts by training phase |

---

## Cloud Functions

### Function Definitions

#### HTTP Functions

```typescript
// functions/src/index.ts

import * as functions from 'firebase-functions'
import express from 'express'

const app = express()

// Auth endpoints
app.post('/auth/strava/callback', stravaCallbackHandler)
app.post('/auth/strava/disconnect', stravaDisconnectHandler)

// Plan endpoints
app.post('/plan/generate', generatePlanHandler)
app.get('/plan/:goalId', getPlanHandler)
app.post('/plan/:goalId/adjust', adjustPlanHandler)

// Workout endpoints
app.get('/workouts/upcoming', getUpcomingWorkoutsHandler)
app.get('/workouts/:workoutId', getWorkoutHandler)
app.post('/workouts/:workoutId/skip', skipWorkoutHandler)
app.post('/workouts/:workoutId/export', exportWorkoutHandler)

// Strava webhook
app.get('/strava/webhook', stravaWebhookVerifyHandler)
app.post('/strava/webhook', stravaWebhookHandler)

// Analytics
app.get('/analytics/progress', getProgressHandler)
app.get('/analytics/activity-history', getActivityHistoryHandler)

export const api = functions.https.onRequest(app)
```

#### Scheduled Functions

```typescript
// Check for missed workouts every hour
export const checkMissedWorkouts = functions.pubsub
  .schedule('0 * * * *')
  .timeZone('UTC')
  .onRun(async () => {
    await missedWorkoutChecker()
  })

// Send workout reminders at user-preferred times
export const sendWorkoutReminders = functions.pubsub
  .schedule('*/15 * * * *')  // Every 15 minutes
  .timeZone('UTC')
  .onRun(async () => {
    await workoutReminderSender()
  })

// Weekly summary emails (Sunday evening)
export const sendWeeklySummaries = functions.pubsub
  .schedule('0 18 * * 0')
  .timeZone('UTC')
  .onRun(async () => {
    await weeklySummarySender()
  })

// Refresh expiring Strava tokens
export const refreshStravaTokens = functions.pubsub
  .schedule('0 */6 * * *')  // Every 6 hours
  .timeZone('UTC')
  .onRun(async () => {
    await tokenRefresher()
  })
```

#### Firestore Triggers

```typescript
// When a plan adjustment is created, send notification
export const onPlanAdjustmentCreated = functions.firestore
  .document('users/{userId}/goals/{goalId}/adjustments/{adjustmentId}')
  .onCreate(async (snapshot, context) => {
    const { userId } = context.params
    const adjustment = snapshot.data() as PlanAdjustment

    await sendPushNotification(userId, {
      title: 'Plan Updated',
      body: adjustment.title,
      data: {
        type: 'plan_adjustment',
        adjustmentId: snapshot.id
      }
    })
  })

// When workout status changes to 'completed', update goal stats
export const onWorkoutCompleted = functions.firestore
  .document('users/{userId}/goals/{goalId}/workouts/{workoutId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as ScheduledWorkout
    const after = change.after.data() as ScheduledWorkout

    if (before.status !== 'completed' && after.status === 'completed') {
      await updateGoalStats(context.params.goalId)
      await checkForPerformanceAdjustments(context.params.userId, after)
    }
  })
```

---

## Error Handling

### Error Codes

```typescript
enum ErrorCode {
  // Authentication
  AUTH_INVALID_CREDENTIALS = 'AUTH_001',
  AUTH_SESSION_EXPIRED = 'AUTH_002',
  AUTH_STRAVA_CONNECTION_FAILED = 'AUTH_003',
  AUTH_STRAVA_TOKEN_EXPIRED = 'AUTH_004',

  // Plan
  PLAN_NOT_FOUND = 'PLAN_001',
  PLAN_GENERATION_FAILED = 'PLAN_002',
  PLAN_INVALID_GOAL = 'PLAN_003',
  PLAN_INSUFFICIENT_TIME = 'PLAN_004',

  // Workout
  WORKOUT_NOT_FOUND = 'WORKOUT_001',
  WORKOUT_ALREADY_COMPLETED = 'WORKOUT_002',
  WORKOUT_MATCH_FAILED = 'WORKOUT_003',

  // Strava
  STRAVA_API_ERROR = 'STRAVA_001',
  STRAVA_RATE_LIMITED = 'STRAVA_002',
  STRAVA_ACTIVITY_NOT_FOUND = 'STRAVA_003',

  // General
  VALIDATION_ERROR = 'VALIDATION_001',
  INTERNAL_ERROR = 'INTERNAL_001',
  NETWORK_ERROR = 'NETWORK_001',
}
```

### Error Response Format

```typescript
interface ErrorResponse {
  success: false
  error: {
    code: ErrorCode
    message: string
    details?: Record<string, any>
    retryable: boolean
  }
}
```

### Client-Side Error Handling

```typescript
// composables/useApi.ts
export function useApi() {
  const toast = useToast()
  const router = useRouter()

  async function request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getIdToken()}`,
          ...options?.headers
        }
      })

      const data = await response.json()

      if (!response.ok) {
        throw new ApiError(data.error)
      }

      return data as T

    } catch (error) {
      if (error instanceof ApiError) {
        handleApiError(error)
      } else {
        toast.error('Network error. Please check your connection.')
      }
      throw error
    }
  }

  function handleApiError(error: ApiError) {
    switch (error.code) {
      case ErrorCode.AUTH_SESSION_EXPIRED:
        router.push('/login?reason=session_expired')
        break

      case ErrorCode.AUTH_STRAVA_TOKEN_EXPIRED:
        router.push('/connect-strava?reason=token_expired')
        break

      case ErrorCode.STRAVA_RATE_LIMITED:
        toast.warning('Please wait a moment before trying again.')
        break

      default:
        toast.error(error.message)
    }
  }

  return { request }
}
```

---

## Core Algorithms

This section defines the four critical algorithms that power RunPlan Pro's core functionality: plan generation, activity matching, performance scoring, and finish time prediction.

### 8.1 Plan Generation Algorithm

The plan generation algorithm transforms user goals and fitness data into a complete, periodized training plan. It follows established running science principles (Jack Daniels' Running Formula, Pfitzinger methodology).

#### Step 1: VDOT Calculation

VDOT (V-dot-O2max estimate) is the foundation for all training paces. It is calculated from the best available data source, in priority order:

```typescript
interface VDOTInput {
  source: 'recent_race' | 'strava_analysis' | 'self_reported'
  // For recent_race:
  raceDistance?: number       // meters
  raceTime?: number           // seconds
  // For strava_analysis:
  recentActivities?: StravaActivity[]
  // For self_reported:
  weeklyVolume?: number       // km
  easyPace?: number           // sec/km
}

function calculateVDOT(input: VDOTInput): number {
  switch (input.source) {
    case 'recent_race':
      // Daniels' VDOT formula from race performance
      // Uses regression model: VDOT = f(velocity, duration)
      // Reference: Daniels' Running Formula, Table 3.1
      return danielsVDOTFromRace(input.raceDistance!, input.raceTime!)

    case 'strava_analysis':
      // Analyze last 6-8 weeks of Strava data
      // Find "quality" runs (tempo-like efforts based on pace distribution)
      // Estimate VDOT from best sustained effort
      const qualityRuns = filterQualityRuns(input.recentActivities!)
      if (qualityRuns.length === 0) {
        // Fallback: estimate from easy pace
        return estimateVDOTFromEasyPace(calculateAverageEasyPace(input.recentActivities!))
      }
      return estimateVDOTFromBestEffort(qualityRuns)

    case 'self_reported':
      // Conservative estimate from weekly volume and easy pace
      return estimateVDOTFromEasyPace(input.easyPace!)
  }
}
```

**VDOT Lookup Table (abbreviated):**

| VDOT | Easy Pace (sec/km) | Tempo Pace (sec/km) | Interval Pace (sec/km) | 5K Time | 10K Time | Half Time | Marathon Time |
|------|-------|-------|-------|---------|----------|-----------|---------------|
| 30 | 7:27-8:08 | 6:24 | 5:51 | 30:40 | 63:46 | 2:21:04 | 4:49:17 |
| 35 | 6:39-7:15 | 5:41 | 5:10 | 27:00 | 56:03 | 2:04:13 | 4:16:03 |
| 40 | 5:58-6:32 | 5:06 | 4:37 | 24:08 | 50:03 | 1:50:38 | 3:49:45 |
| 45 | 5:26-5:56 | 4:37 | 4:10 | 21:50 | 45:16 | 1:39:35 | 3:28:26 |
| 50 | 4:59-5:26 | 4:13 | 3:48 | 19:57 | 41:21 | 1:30:28 | 3:10:49 |
| 55 | 4:36-5:01 | 3:52 | 3:29 | 18:23 | 38:04 | 1:22:49 | 2:56:01 |
| 60 | 4:16-4:39 | 3:35 | 3:13 | 17:03 | 35:17 | 1:16:18 | 2:43:25 |
| 65 | 3:59-4:21 | 3:19 | 2:59 | 15:54 | 32:53 | 1:10:38 | 2:32:35 |

*Full table stored as constant in `functions/src/algorithms/vdotTable.ts`*

#### Step 2: Training Pace Zones

From VDOT, derive all training paces:

```typescript
interface TrainingPaces {
  easy: { min: number; max: number }     // sec/km, range
  long: { min: number; max: number }     // same as easy or slightly slower
  tempo: { min: number; max: number }    // ~threshold pace, narrow range
  interval: { min: number; max: number } // VO2max pace
  recovery: { min: number; max: number } // slower than easy
  race: { min: number; max: number }     // goal race pace
}

function calculateTrainingPaces(vdot: number, goalRaceDistance: number, goalRaceTime?: number): TrainingPaces {
  const basePaces = lookupVDOTPaces(vdot)

  // If user has a specific time goal, adjust race pace accordingly
  const racePace = goalRaceTime
    ? goalRaceTime / (goalRaceDistance / 1000)  // sec/km
    : basePaces.racePace[goalRaceDistance]

  return {
    easy:     { min: basePaces.easy - 15, max: basePaces.easy + 15 },
    long:     { min: basePaces.easy - 5, max: basePaces.easy + 20 },
    tempo:    { min: basePaces.tempo - 5, max: basePaces.tempo + 5 },
    interval: { min: basePaces.interval - 5, max: basePaces.interval + 5 },
    recovery: { min: basePaces.easy + 20, max: basePaces.easy + 45 },
    race:     { min: racePace - 5, max: racePace + 5 },
  }
}
```

#### Step 3: Phase Distribution

The training plan is divided into periodized phases. Distribution depends on available weeks:

```typescript
interface PhaseConfig {
  name: 'base' | 'build' | 'peak' | 'taper'
  weekRatio: number      // proportion of total weeks
  focus: string
  workoutMix: Record<WorkoutType, number>  // proportion per week
}

const PHASE_CONFIGS: PhaseConfig[] = [
  {
    name: 'base',
    weekRatio: 0.35,        // ~35% of total training time
    focus: 'Building aerobic base and running consistency',
    workoutMix: { easy: 0.50, long: 0.20, tempo: 0.10, intervals: 0.00, recovery: 0.20, race: 0 }
  },
  {
    name: 'build',
    weekRatio: 0.30,        // ~30% of total training time
    focus: 'Introducing speed work and increasing volume',
    workoutMix: { easy: 0.35, long: 0.20, tempo: 0.15, intervals: 0.10, recovery: 0.20, race: 0 }
  },
  {
    name: 'peak',
    weekRatio: 0.20,        // ~20% of total training time
    focus: 'Race-specific fitness and highest volume',
    workoutMix: { easy: 0.30, long: 0.15, tempo: 0.15, intervals: 0.15, recovery: 0.25, race: 0 }
  },
  {
    name: 'taper',
    weekRatio: 0.15,        // ~15% of total training time (min 1 week, max 3 weeks)
    focus: 'Reducing volume while maintaining intensity for peak race performance',
    workoutMix: { easy: 0.40, long: 0.10, tempo: 0.15, intervals: 0.10, recovery: 0.25, race: 0 }
  }
]

function distributePhases(totalWeeks: number): Array<{ phase: PhaseConfig; weeks: number }> {
  // Taper: 1 week for 5K/10K, 2 weeks for half, 3 weeks for marathon
  const taperWeeks = Math.min(3, Math.max(1, Math.round(totalWeeks * 0.15)))
  const remainingWeeks = totalWeeks - taperWeeks

  const baseWeeks = Math.round(remainingWeeks * 0.40)
  const buildWeeks = Math.round(remainingWeeks * 0.35)
  const peakWeeks = remainingWeeks - baseWeeks - buildWeeks  // remainder

  return [
    { phase: PHASE_CONFIGS[0], weeks: baseWeeks },
    { phase: PHASE_CONFIGS[1], weeks: buildWeeks },
    { phase: PHASE_CONFIGS[2], weeks: peakWeeks },
    { phase: PHASE_CONFIGS[3], weeks: taperWeeks },
  ]
}
```

#### Step 4: Weekly Volume Progression

Weekly training volume follows the **10% rule** with built-in recovery weeks:

```typescript
interface VolumeProgression {
  weekNumber: number
  totalDistance: number      // km
  longRunDistance: number    // km
  isRecoveryWeek: boolean
}

function calculateVolumeProgression(
  totalWeeks: number,
  startingWeeklyVolume: number,  // km (from Strava analysis or default)
  peakWeeklyVolume: number,       // km (calculated from goal distance)
  goalDistance: number             // meters
): VolumeProgression[] {
  const progression: VolumeProgression[] = []

  // Peak volume targets by race distance:
  // 5K:   30-40 km/week
  // 10K:  40-55 km/week
  // Half: 50-70 km/week
  // Marathon: 65-90 km/week

  // Recovery week every 3rd or 4th week (reduce volume by 20-30%)
  const recoveryInterval = totalWeeks >= 12 ? 4 : 3

  for (let week = 1; week <= totalWeeks; week++) {
    const isRecoveryWeek = week % recoveryInterval === 0
    const phase = getPhaseForWeek(week, totalWeeks)

    let targetVolume: number

    if (phase === 'taper') {
      // Taper: reduce 20-25% per week from peak
      const taperWeeksRemaining = totalWeeks - week
      targetVolume = peakWeeklyVolume * (0.5 + (taperWeeksRemaining * 0.15))
    } else if (isRecoveryWeek) {
      // Recovery: 70-80% of previous week
      targetVolume = progression[week - 2].totalDistance * 0.75
    } else {
      // Progressive increase: linear interpolation from start to peak
      const progressRatio = week / (totalWeeks - taperWeeks)
      targetVolume = startingWeeklyVolume + (peakWeeklyVolume - startingWeeklyVolume) * Math.min(1, progressRatio)

      // Enforce max 10% increase from previous non-recovery week
      const prevNonRecoveryVolume = findPreviousNonRecoveryVolume(progression)
      if (prevNonRecoveryVolume > 0) {
        targetVolume = Math.min(targetVolume, prevNonRecoveryVolume * 1.10)
      }
    }

    // Long run: 25-35% of weekly volume (capped at goal distance for marathon)
    const longRunRatio = phase === 'base' ? 0.25 : phase === 'peak' ? 0.35 : 0.30
    const longRunDistance = Math.min(
      targetVolume * longRunRatio,
      goalDistance / 1000 * 0.85  // Never exceed 85% of race distance in training
    )

    progression.push({
      weekNumber: week,
      totalDistance: Math.round(targetVolume * 10) / 10,
      longRunDistance: Math.round(longRunDistance * 10) / 10,
      isRecoveryWeek,
    })
  }

  return progression
}
```

#### Step 5: Workout Generation

For each day in the plan, generate a specific workout:

```typescript
function generateWeekWorkouts(
  weekConfig: VolumeProgression,
  phase: PhaseConfig,
  trainingDays: number[],       // user's available days
  longRunDay: number,
  paces: TrainingPaces,
  maxSessionMinutes: number
): ScheduledWorkout[] {
  const workouts: ScheduledWorkout[] = []
  const workoutMix = phase.workoutMix
  const availableDays = [...trainingDays].sort()
  const weekVolume = weekConfig.totalDistance

  // 1. Place long run first (anchored day)
  workouts.push(createWorkout({
    day: longRunDay,
    type: 'long',
    distance: weekConfig.longRunDistance,
    paces: paces.long,
  }))

  // 2. Place key workouts (tempo/intervals) with adequate spacing
  //    - At least 1 easy/recovery day between quality sessions
  //    - Key workouts in mid-week preferred (Tue/Wed/Thu)
  const remainingDays = availableDays.filter(d => d !== longRunDay)
  const remainingVolume = weekVolume - weekConfig.longRunDistance
  const workoutsToDistribute = selectWorkoutTypes(workoutMix, remainingDays.length)

  // 3. Sort by priority: intervals > tempo > easy > recovery
  //    Place hard workouts first to ensure spacing
  const sorted = workoutsToDistribute.sort(byIntensityDesc)

  for (const workoutType of sorted) {
    const bestDay = findBestDay(remainingDays, workouts, workoutType)
    const distance = calculateWorkoutDistance(workoutType, remainingVolume, remainingDays.length)

    workouts.push(createWorkout({
      day: bestDay,
      type: workoutType,
      distance,
      paces: paces[workoutType],
      maxDuration: maxSessionMinutes * 60,
      structure: generateStructure(workoutType, distance, paces),
    }))
  }

  return workouts
}
```

#### Workout Structure Templates

```typescript
function generateStructure(type: WorkoutType, distance: number, paces: TrainingPaces): WorkoutStructure[] {
  switch (type) {
    case 'easy':
    case 'long':
    case 'recovery':
      return [{ type: 'main', distance, pace: paces[type] }]

    case 'tempo':
      const warmup = Math.min(2000, distance * 0.2)
      const cooldown = Math.min(2000, distance * 0.2)
      const mainSet = distance - warmup - cooldown
      return [
        { type: 'warmup', distance: warmup, pace: paces.easy },
        { type: 'main', distance: mainSet, pace: paces.tempo },
        { type: 'cooldown', distance: cooldown, pace: paces.easy },
      ]

    case 'intervals':
      // Interval distance based on goal: 400m-1600m
      // Total interval volume: 5-8% of weekly volume
      const intervalDistance = selectIntervalDistance(distance)
      const recoveryDistance = intervalDistance * 0.5     // jog recovery
      const reps = Math.floor((distance * 0.6) / (intervalDistance + recoveryDistance))
      const iWarmup = Math.min(2000, distance * 0.2)
      const iCooldown = distance - iWarmup - (reps * (intervalDistance + recoveryDistance))
      return [
        { type: 'warmup', distance: iWarmup, pace: paces.easy },
        {
          type: 'interval',
          distance: intervalDistance,
          pace: paces.interval,
          repeats: reps,
          recoveryDistance,
          recoveryPace: paces.recovery,
        },
        { type: 'cooldown', distance: Math.max(1000, iCooldown), pace: paces.easy },
      ]
  }
}
```

---

### 8.2 Activity-to-Workout Matching Algorithm

When a Strava activity arrives via webhook, the system must determine which scheduled workout (if any) it corresponds to. This uses multi-factor scoring.

#### Matching Process

```typescript
interface MatchCandidate {
  workout: ScheduledWorkout
  score: number             // 0-1 composite score
  factors: MatchFactors
}

interface MatchFactors {
  typeScore: number         // 0-1: activity type compatibility
  distanceScore: number     // 0-1: distance similarity
  paceScore: number         // 0-1: pace range compliance
  timeProximityScore: number // 0-1: how close to scheduled date
}

// Factor weights
const MATCH_WEIGHTS = {
  type: 0.20,
  distance: 0.40,
  pace: 0.25,
  timeProximity: 0.15,
}

// Confidence thresholds
const AUTO_MATCH_THRESHOLD = 0.75     // Auto-match: high confidence
const LOW_CONFIDENCE_THRESHOLD = 0.40 // Flag for review if between 0.40-0.74
// Below 0.40: no match (store as unplanned activity)

async function matchActivityToWorkout(
  activity: CompletedActivity,
  userId: string,
  goalId: string
): Promise<MatchCandidate | null> {

  // 1. Find candidate workouts (scheduled, within time window)
  const candidates = await getCandidateWorkouts(userId, goalId, activity.startTime, {
    windowBefore: 24 * 60 * 60,  // 24 hours before activity
    windowAfter: 6 * 60 * 60,    // 6 hours after (for timezone edge cases)
    statusFilter: ['scheduled'],
  })

  if (candidates.length === 0) return null

  // 2. Score each candidate
  const scored: MatchCandidate[] = candidates.map(workout => {
    const factors = calculateMatchFactors(activity, workout)
    const score =
      factors.typeScore * MATCH_WEIGHTS.type +
      factors.distanceScore * MATCH_WEIGHTS.distance +
      factors.paceScore * MATCH_WEIGHTS.pace +
      factors.timeProximityScore * MATCH_WEIGHTS.timeProximity

    return { workout, score, factors }
  })

  // 3. Sort by score descending, return best match
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]

  if (best.score >= AUTO_MATCH_THRESHOLD) {
    return best
  } else if (best.score >= LOW_CONFIDENCE_THRESHOLD) {
    // Match but flag low confidence for user review
    return { ...best, lowConfidence: true }
  }

  return null  // No match
}
```

#### Factor Scoring Functions

```typescript
function calculateMatchFactors(activity: CompletedActivity, workout: ScheduledWorkout): MatchFactors {

  // TYPE SCORE: Is the activity type compatible with the workout?
  const typeScore = calculateTypeScore(activity.type, workout.type)

  // DISTANCE SCORE: How close is actual vs planned distance?
  const distanceRatio = activity.distance / workout.plannedDistance
  const distanceScore = distanceRatio >= 0.7 && distanceRatio <= 1.5
    ? 1 - Math.abs(1 - distanceRatio) * 1.5    // Gradual penalty for deviation
    : distanceRatio >= 0.5 ? 0.3 : 0.0          // Partial credit for 50-70%

  // PACE SCORE: Was the pace within target range?
  const paceScore = workout.targetPace
    ? calculatePaceScore(activity.averagePace, workout.targetPace)
    : 0.7  // Neutral score if no pace target

  // TIME PROXIMITY: How close to the scheduled date?
  const hoursDiff = Math.abs(
    activity.startTime.toMillis() - workout.date.toMillis()
  ) / (1000 * 60 * 60)
  const timeProximityScore = hoursDiff <= 3  ? 1.0
                           : hoursDiff <= 12 ? 0.8
                           : hoursDiff <= 24 ? 0.5
                           : 0.2

  return { typeScore, distanceScore, paceScore, timeProximityScore }
}

function calculateTypeScore(stravaType: string, workoutType: WorkoutType): number {
  // Strava types: 'Run', 'TrailRun', 'Treadmill', 'VirtualRun'
  // All are compatible with our workout types
  const runTypes = ['Run', 'TrailRun', 'Treadmill', 'VirtualRun']
  if (!runTypes.includes(stravaType)) return 0.0  // Not a run at all

  // Treadmill/Virtual runs get slight penalty for pace-sensitive workouts
  if (['Treadmill', 'VirtualRun'].includes(stravaType) && ['tempo', 'intervals'].includes(workoutType)) {
    return 0.7
  }

  return 1.0  // Run matches any workout type
}

function calculatePaceScore(actualPace: number, targetPace: { min: number; max: number }): number {
  if (actualPace >= targetPace.min && actualPace <= targetPace.max) {
    return 1.0  // Perfect: within target range
  }

  // Calculate how far outside the range
  const rangeMidpoint = (targetPace.min + targetPace.max) / 2
  const rangeWidth = targetPace.max - targetPace.min
  const deviation = Math.abs(actualPace - rangeMidpoint) / rangeWidth

  return Math.max(0, 1 - deviation * 0.4)  // Gradual penalty
}
```

---

### 8.3 Performance Score Calculation

The performance score (0-100) evaluates how well a completed activity matches the planned workout targets. It is context-aware: running too fast on an easy day is penalized, not rewarded.

#### Score Calculation

```typescript
interface PerformanceResult {
  score: number            // 0-100
  breakdown: {
    paceScore: number      // 0-100, weight: 40%
    distanceScore: number  // 0-100, weight: 35%
    heartRateScore: number // 0-100, weight: 25% (0 if no HR data, redistributed)
  }
  feedback: string         // Human-readable performance summary
}

function calculatePerformanceScore(
  activity: CompletedActivity,
  workout: ScheduledWorkout
): PerformanceResult {

  const hasHR = activity.averageHeartRate != null && workout.targetHeartRateZone != null
  const weights = hasHR
    ? { pace: 0.40, distance: 0.35, hr: 0.25 }
    : { pace: 0.55, distance: 0.45, hr: 0 }

  // PACE SCORE (context-aware)
  const paceScore = calculateContextAwarePaceScore(
    activity.averagePace,
    workout.targetPace!,
    workout.type
  )

  // DISTANCE SCORE
  const distanceRatio = activity.distance / workout.plannedDistance
  const distanceScore = distanceRatio >= 0.90 && distanceRatio <= 1.15
    ? 100                                        // 90-115%: perfect
    : distanceRatio >= 0.80 && distanceRatio <= 1.25
      ? 80 - Math.abs(1 - distanceRatio) * 100  // 80-125%: good with penalty
      : Math.max(20, 60 - Math.abs(1 - distanceRatio) * 120) // Outside: significant penalty

  // HEART RATE SCORE
  const heartRateScore = hasHR
    ? calculateHRZoneScore(activity.averageHeartRate!, workout.targetHeartRateZone!)
    : 0

  const totalScore = Math.round(
    paceScore * weights.pace +
    distanceScore * weights.distance +
    heartRateScore * weights.hr
  )

  const feedback = generateFeedback(totalScore, paceScore, distanceScore, heartRateScore, workout.type)

  return {
    score: Math.min(100, Math.max(0, totalScore)),
    breakdown: { paceScore, distanceScore, heartRateScore },
    feedback,
  }
}
```

#### Context-Aware Pace Scoring

Different workout types have different "ideal" pace behaviors:

```typescript
function calculateContextAwarePaceScore(
  actualPace: number,
  targetPace: { min: number; max: number },
  workoutType: WorkoutType
): number {

  const inRange = actualPace >= targetPace.min && actualPace <= targetPace.max

  if (inRange) return 100

  const rangeMidpoint = (targetPace.min + targetPace.max) / 2
  const deviation = (actualPace - rangeMidpoint) / rangeMidpoint  // positive = slower, negative = faster

  switch (workoutType) {
    case 'easy':
    case 'recovery':
    case 'long':
      // PENALIZE running too fast (negative deviation = faster)
      // These workouts should be controlled; going too fast risks injury/overtraining
      if (deviation < 0) {
        // Too fast: significant penalty
        return Math.max(30, 100 - Math.abs(deviation) * 300)
      } else {
        // Too slow: mild penalty (still building fitness)
        return Math.max(50, 100 - deviation * 150)
      }

    case 'tempo':
    case 'intervals':
      // REWARD being close to target; slight asymmetry favoring faster
      if (deviation < 0) {
        // Faster than target: mild penalty (good effort, but risky if too fast)
        return Math.max(50, 100 - Math.abs(deviation) * 200)
      } else {
        // Slower than target: moderate penalty
        return Math.max(30, 100 - deviation * 250)
      }

    case 'race':
      // Symmetric: any deviation from race pace is equally bad
      return Math.max(20, 100 - Math.abs(deviation) * 300)

    default:
      return 70
  }
}
```

#### Heart Rate Zone Scoring

```typescript
const HR_ZONES = [
  { zone: 1, minPct: 0.50, maxPct: 0.60 },  // Recovery
  { zone: 2, minPct: 0.60, maxPct: 0.70 },  // Easy/Aerobic
  { zone: 3, minPct: 0.70, maxPct: 0.80 },  // Tempo
  { zone: 4, minPct: 0.80, maxPct: 0.90 },  // Threshold
  { zone: 5, minPct: 0.90, maxPct: 1.00 },  // VO2max
]

function calculateHRZoneScore(avgHR: number, targetZone: number, maxHR?: number): number {
  // maxHR from Strava profile or estimate: 220 - age
  const effectiveMaxHR = maxHR || 190  // conservative default
  const hrPct = avgHR / effectiveMaxHR

  const zone = HR_ZONES[targetZone - 1]

  if (hrPct >= zone.minPct && hrPct <= zone.maxPct) {
    return 100  // In target zone
  }

  // Penalty based on zones away from target
  const zoneDiff = hrPct < zone.minPct
    ? (zone.minPct - hrPct) / 0.10   // zones below
    : (hrPct - zone.maxPct) / 0.10    // zones above

  return Math.max(20, 100 - zoneDiff * 30)
}
```

#### Feedback Generation

```typescript
function generateFeedback(
  total: number,
  pace: number,
  distance: number,
  hr: number,
  workoutType: WorkoutType
): string {
  // Excellent performance
  if (total >= 90) {
    const messages = {
      easy: 'Great job staying in the easy zone! This discipline builds your aerobic base.',
      long: 'Excellent long run execution! Consistent pacing is key for race day.',
      tempo: 'Strong tempo effort! Your lactate threshold is improving.',
      intervals: 'Great interval session! You nailed the target paces.',
      recovery: 'Perfect recovery run. Your body will thank you tomorrow.',
      race: 'Outstanding race execution! Right on your goal pace.',
    }
    return messages[workoutType]
  }

  // Good performance
  if (total >= 70) {
    if (pace < 60 && ['easy', 'recovery', 'long'].includes(workoutType)) {
      return 'Solid effort, but try to slow down on easy days. Recovery pace helps you train harder on quality days.'
    }
    if (distance < 70) {
      return 'Good pace control! Try to complete the full planned distance next time.'
    }
    return 'Good workout! Small improvements in pacing will push your score higher.'
  }

  // Needs improvement
  if (total >= 50) {
    return 'Decent effort. Review your target paces and try to stay closer to the plan.'
  }

  // Below expectations
  return 'This workout deviated significantly from the plan. That\'s okay - listen to your body and we\'ll adjust.'
}
```

---

### 8.4 Finish Time Prediction Algorithm

The predicted finish time is displayed on the dashboard and progress screen. It combines VDOT-based prediction with trend analysis from recent training.

#### Prediction Process

```typescript
interface FinishTimePrediction {
  predictedTime: number     // seconds
  confidence: number        // 0-1
  trend: 'improving' | 'stable' | 'declining'
  vsTarget: number          // seconds difference (negative = ahead of target)
}

function predictFinishTime(
  goalId: string,
  currentVDOT: number,
  goalDistance: number,       // meters
  targetTime: number | null,  // seconds (null if "just finish")
  recentWorkouts: ScheduledWorkout[],  // last 4-6 weeks, completed only
): FinishTimePrediction {

  // 1. Base prediction from current VDOT
  const basePrediction = danielsRaceTimePrediction(currentVDOT, goalDistance)

  // 2. Adjust based on recent training quality
  const trainingFactor = calculateTrainingFactor(recentWorkouts)

  // 3. Calculate trend from VDOT progression
  const vdotHistory = calculateVDOTHistory(recentWorkouts)
  const trend = analyzeTrend(vdotHistory)

  // 4. Apply trend adjustment
  const trendAdjustment = trend === 'improving' ? 0.98   // 2% faster
                        : trend === 'declining' ? 1.03   // 3% slower
                        : 1.0                            // stable

  const predictedTime = Math.round(basePrediction * trainingFactor * trendAdjustment)

  // 5. Calculate confidence
  const confidence = calculatePredictionConfidence(recentWorkouts, vdotHistory)

  return {
    predictedTime,
    confidence,
    trend,
    vsTarget: targetTime ? predictedTime - targetTime : 0,
  }
}
```

#### VDOT History and Updates

VDOT is recalculated from quality workouts (tempo, intervals, races):

```typescript
function calculateVDOTHistory(
  recentWorkouts: ScheduledWorkout[]
): Array<{ date: Timestamp; vdot: number }> {
  const qualityWorkouts = recentWorkouts.filter(w =>
    w.status === 'completed' &&
    ['tempo', 'intervals', 'race'].includes(w.type) &&
    w.performance && w.performance.score >= 60  // Only use decent performances
  )

  return qualityWorkouts.map(w => ({
    date: w.date,
    vdot: estimateVDOTFromWorkout(w),
  }))
}

function estimateVDOTFromWorkout(workout: ScheduledWorkout): number {
  const perf = workout.performance!

  switch (workout.type) {
    case 'tempo':
      // Sustained effort: use actual pace and duration to estimate VDOT
      return danielsVDOTFromRace(perf.actualDistance, perf.actualDuration)

    case 'intervals':
      // Use average interval pace (exclude warmup/cooldown)
      // Apply 1.05x multiplier (intervals slightly overestimate VDOT)
      const intervalVDOT = danielsVDOTFromPace(perf.actualPace, 'interval')
      return intervalVDOT * 0.95  // Conservative adjustment

    case 'race':
      // Most accurate: direct race performance
      return danielsVDOTFromRace(perf.actualDistance, perf.actualDuration)

    default:
      return 0  // Easy/recovery runs don't reliably estimate VDOT
  }
}
```

#### Training Factor

Accounts for training compliance and volume adherence:

```typescript
function calculateTrainingFactor(recentWorkouts: ScheduledWorkout[]): number {
  // A factor of 1.0 = training going as planned
  // < 1.0 = better than planned (faster prediction)
  // > 1.0 = worse than planned (slower prediction)

  const totalWorkouts = recentWorkouts.length
  const completedWorkouts = recentWorkouts.filter(w => w.status === 'completed').length
  const complianceRate = completedWorkouts / totalWorkouts

  // Calculate average performance score of completed workouts
  const avgPerformance = recentWorkouts
    .filter(w => w.performance)
    .reduce((sum, w) => sum + w.performance!.score, 0) / completedWorkouts

  // High compliance + high performance = positive factor
  if (complianceRate >= 0.85 && avgPerformance >= 80) return 0.97
  if (complianceRate >= 0.70 && avgPerformance >= 70) return 1.0
  if (complianceRate >= 0.50) return 1.03
  return 1.08  // Low compliance: significantly slower prediction
}
```

#### Prediction Confidence

```typescript
function calculatePredictionConfidence(
  recentWorkouts: ScheduledWorkout[],
  vdotHistory: Array<{ date: Timestamp; vdot: number }>
): number {
  let confidence = 0.5  // Base confidence

  // More completed quality workouts = higher confidence
  const qualityCount = vdotHistory.length
  confidence += Math.min(0.2, qualityCount * 0.04)  // Up to +0.20 for 5+ quality workouts

  // Consistent VDOT readings = higher confidence
  if (vdotHistory.length >= 3) {
    const stdDev = calculateStdDev(vdotHistory.map(v => v.vdot))
    const meanVDOT = vdotHistory.reduce((s, v) => s + v.vdot, 0) / vdotHistory.length
    const cv = stdDev / meanVDOT  // coefficient of variation
    confidence += cv < 0.03 ? 0.15 : cv < 0.06 ? 0.10 : 0.05
  }

  // Higher compliance = higher confidence
  const completedCount = recentWorkouts.filter(w => w.status === 'completed').length
  const compliance = completedCount / recentWorkouts.length
  confidence += compliance >= 0.80 ? 0.15 : compliance >= 0.60 ? 0.10 : 0.0

  return Math.min(0.95, confidence)  // Never 100% confident
}

function analyzeTrend(vdotHistory: Array<{ date: Timestamp; vdot: number }>): 'improving' | 'stable' | 'declining' {
  if (vdotHistory.length < 3) return 'stable'  // Not enough data

  // Simple linear regression on VDOT over time
  const slope = linearRegressionSlope(
    vdotHistory.map(v => v.date.toMillis()),
    vdotHistory.map(v => v.vdot)
  )

  // VDOT change per week
  const weeklyChange = slope * (7 * 24 * 60 * 60 * 1000)

  if (weeklyChange > 0.3) return 'improving'    // Gaining >0.3 VDOT per week
  if (weeklyChange < -0.3) return 'declining'   // Losing >0.3 VDOT per week
  return 'stable'
}
```

---

## Testing Strategy

### Overview

Testing is critical for RunPlan Pro due to the algorithmic complexity (plan generation, matching, scoring) and reliance on external services (Strava API, Firebase). The strategy follows a **testing pyramid** approach: many unit tests, fewer integration tests, and minimal end-to-end tests.

### Test Stack

| Tool | Purpose |
|------|---------|
| **Vitest** | Unit & integration test runner (Vite-native, fast) |
| **Vue Test Utils** | Vue component testing |
| **@firebase/rules-unit-testing** | Firestore security rules testing |
| **Firebase Emulator Suite** | Local Firebase services for integration tests |
| **Playwright** | End-to-end browser testing |
| **MSW (Mock Service Worker)** | API mocking for frontend tests |

### Test Categories

#### 1. Unit Tests (Target: 80%+ coverage on algorithms)

Critical algorithm code must have thorough unit tests:

```
tests/unit/
├── algorithms/
│   ├── vdot.test.ts                  # VDOT calculation from various inputs
│   ├── paceZones.test.ts             # Training pace derivation
│   ├── phaseDistribution.test.ts     # Phase allocation for different plan lengths
│   ├── volumeProgression.test.ts     # Weekly volume with 10% rule, recovery weeks
│   ├── workoutGeneration.test.ts     # Workout placement, spacing, structure
│   ├── activityMatching.test.ts      # Multi-factor matching scoring
│   ├── performanceScore.test.ts      # Context-aware scoring (easy too fast, etc.)
│   └── finishTimePrediction.test.ts  # VDOT trend, training factor, confidence
├── composables/
│   ├── useAuth.test.ts               # Auth state management
│   ├── usePlan.test.ts               # Plan data binding
│   └── useApi.test.ts                # API error handling, retries
└── utils/
    ├── dateHelpers.test.ts           # Timezone handling, week boundaries
    └── formatting.test.ts            # Pace formatting, distance units
```

**Key test scenarios for algorithms:**

- VDOT: known race times → expected VDOT (validate against Daniels' table)
- Plan generation: 12-week half marathon → correct phase distribution, volume curve
- Activity matching: various Strava activities → correct match scores and thresholds
- Performance scoring: easy run at tempo pace → penalized (not rewarded)
- Finish time: declining VDOT trend → slower prediction with lower confidence

#### 2. Component Tests (Target: key UI flows)

```
tests/components/
├── onboarding/
│   ├── GoalTypeStep.test.ts          # Selection including custom distance
│   ├── RaceDateStep.test.ts          # Calendar, minimum weeks validation
│   └── ScheduleStep.test.ts          # Day selection, minimum 3 days
├── workout/
│   ├── WorkoutCard.test.ts           # Scheduled/completed/missed states
│   └── WorkoutDetail.test.ts         # Planned vs actual comparison
├── dashboard/
│   └── DashboardPage.test.ts         # Loading, empty, data states
└── common/
    └── BottomNav.test.ts             # Active state, navigation
```

#### 3. Integration Tests (Target: API + Firestore flows)

Run against Firebase Emulator Suite:

```
tests/integration/
├── strava/
│   ├── webhookReceiver.test.ts       # Webhook validation, event processing
│   ├── oauthFlow.test.ts             # Token exchange, storage, refresh
│   └── activitySync.test.ts          # Full activity → match → score pipeline
├── planning/
│   ├── planGeneration.test.ts        # Generate plan → verify Firestore structure
│   ├── adaptivePlanning.test.ts      # Missed workout → plan adjustment
│   └── missedWorkoutDetection.test.ts # Scheduled function behavior
└── firestore/
    ├── securityRules.test.ts         # Users can only access own data
    └── triggers.test.ts              # onWorkoutCompleted, onAdjustmentCreated
```

**Firestore security rules test example:**

```typescript
// tests/integration/firestore/securityRules.test.ts
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing'

describe('Firestore Security Rules', () => {
  it('users can only read their own profile', async () => {
    const userA = testEnv.authenticatedContext('user-a')
    const userB = testEnv.authenticatedContext('user-b')

    await assertSucceeds(userA.firestore().doc('users/user-a').get())
    await assertFails(userB.firestore().doc('users/user-a').get())
  })

  it('unauthenticated users cannot access any data', async () => {
    const unauth = testEnv.unauthenticatedContext()
    await assertFails(unauth.firestore().doc('users/user-a').get())
  })

  it('stravaTokens are only accessible via admin SDK', async () => {
    const userA = testEnv.authenticatedContext('user-a')
    await assertFails(userA.firestore().doc('users/user-a/stravaTokens').get())
  })
})
```

#### 4. End-to-End Tests (Target: critical user flows)

```
tests/e2e/
├── auth.spec.ts                      # Sign up, login, logout
├── onboarding.spec.ts                # Full goal setup flow → plan created
├── workoutCompletion.spec.ts         # Strava webhook → workout marked complete
└── planAdjustment.spec.ts            # Missed workout → adjustment notification
```

### Test Commands

```bash
# Unit tests
npm run test:unit                     # Run with Vitest
npm run test:unit -- --coverage       # With coverage report

# Component tests
npm run test:components               # Vue Test Utils + Vitest

# Integration tests (requires emulators)
npm run test:integration              # Starts emulators, runs tests, stops emulators

# E2E tests
npm run test:e2e                      # Playwright against local dev server

# All tests
npm run test                          # Runs unit + component + integration
```

### Coverage Requirements

| Area | Minimum Coverage | Rationale |
|------|-----------------|-----------|
| `functions/src/algorithms/` | 90% | Core business logic, bugs = bad plans |
| `functions/src/strava/` | 80% | External integration, many edge cases |
| `functions/src/planning/` | 85% | Adaptive logic affects user experience |
| `src/composables/` | 75% | State management, error handling |
| `src/components/` | 60% | UI components, focus on interaction logic |

---

## CI/CD Pipeline

### Overview

The CI/CD pipeline uses **GitHub Actions** for automated testing, building, and deployment. It follows a trunk-based development model with feature branches.

### Pipeline Stages

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  Lint   │───▶│  Test   │───▶│  Build  │───▶│ Preview │───▶│ Deploy  │
│         │    │         │    │         │    │         │    │         │
│ ESLint  │    │ Unit    │    │ Vite    │    │Firebase │    │Firebase │
│ TypeScr.│    │ Integr. │    │ build   │    │Preview  │    │Hosting  │
│ Prettier│    │ Rules   │    │ CF build│    │Channel  │    │+ CF     │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
```

### GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '18'
  FIREBASE_PROJECT_ID: runplan-pro

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  test-unit:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  test-integration:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm install -g firebase-tools
      - run: npm run test:integration
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}

  build:
    runs-on: ubuntu-latest
    needs: [test-unit, test-integration]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm run build:functions
      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: |
            dist/
            functions/lib/

  preview:
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: build-output
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          projectId: ${{ env.FIREBASE_PROJECT_ID }}
          channelId: pr-${{ github.event.number }}

  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: build-output
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm install -g firebase-tools
      - run: firebase deploy --only hosting,functions
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}
```

### Branch Strategy

| Branch | Purpose | Deploys to |
|--------|---------|-----------|
| `main` | Production-ready code | Firebase Hosting (production) |
| `feature/*` | Feature development | Preview channel (via PR) |
| `fix/*` | Bug fixes | Preview channel (via PR) |

### Environment Variables & Secrets

Required GitHub repository secrets:

| Secret | Purpose |
|--------|---------|
| `FIREBASE_TOKEN` | Firebase CLI authentication token |
| `FIREBASE_SERVICE_ACCOUNT` | Service account JSON for hosting preview |
| `STRAVA_CLIENT_ID` | Strava API client ID (for integration tests) |
| `STRAVA_CLIENT_SECRET` | Strava API client secret (for integration tests) |

### Pre-commit Hooks (Husky + lint-staged)

```json
// package.json (partial)
{
  "lint-staged": {
    "*.{ts,vue}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged
```

---

## PWA & Offline Strategy

RunPlan Pro is delivered as a Progressive Web App for installability and offline capability.

### Vite PWA Configuration

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'RunPlan Pro',
        short_name: 'RunPlan',
        description: 'Adaptive training plans for runners',
        theme_color: '#1a73e8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/dashboard',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Firebase Auth — network only (tokens must be fresh)
            urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com\//,
            handler: 'NetworkOnly',
          },
          {
            // Firestore REST — stale-while-revalidate
            urlPattern: /^https:\/\/firestore\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'firestore-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 }, // 1 hour
            },
          },
          {
            // Strava API — network first (activity data must be fresh)
            urlPattern: /^https:\/\/www\.strava\.com\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'strava-api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 30 }, // 30 min
            },
          },
          {
            // Cloud Functions API — network first
            urlPattern: /^https:\/\/us-central1-runplan-pro\.cloudfunctions\.net\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 }, // 1 hour
            },
          },
        ],
      },
    }),
  ],
})
```

### Offline Data Strategy

RunPlan Pro uses **Firestore's built-in offline persistence** as the primary offline data layer (not the Service Worker cache for Firestore data).

```typescript
// firebase.ts
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})
```

**Offline behavior by feature:**

| Feature | Offline Behavior | Sync Strategy |
|---------|-----------------|---------------|
| Dashboard | Shows cached data from last sync | Auto-syncs when online |
| Calendar | Shows cached workouts | Auto-syncs when online |
| Workout Detail | Shows cached workout data | Auto-syncs when online |
| Progress | Shows cached stats and charts | Auto-syncs when online |
| Mark as Skipped | Queued locally, synced when online | Firestore offline writes |
| Strava Sync | Not available offline | Banner: "Strava sync requires internet" |
| Plan Generation | Not available offline | Banner: "Creating a plan requires internet" |
| Settings Changes | Queued locally, synced when online | Firestore offline writes |

### Update Prompt

When a new version is deployed, users see a non-blocking toast:

```typescript
// composables/usePWAUpdate.ts
import { useRegisterSW } from 'virtual:pwa-register/vue'

export function usePWAUpdate() {
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegistered(registration) {
      // Check for updates every 15 minutes
      setInterval(() => registration?.update(), 15 * 60 * 1000)
    },
  })

  return { needRefresh, updateServiceWorker }
}
```

**Toast message:** "A new version is available." + "Update" button. Dismissible; will re-appear after 24h if not applied.

### Install Prompt

Show an install banner on the Dashboard after the user's 3rd session (tracked via `localStorage`):

```
┌────────────────────────────────────────┐
│ 📱 Install RunPlan Pro for quick       │
│    access from your home screen.       │
│                          [Install] [✕] │
└────────────────────────────────────────┘
```

Dismissed installs are not shown again for 30 days.

---

## Push Notifications & FCM Token Management

### FCM Setup

RunPlan Pro uses Firebase Cloud Messaging (FCM) for push notifications via the web push API.

### Token Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                   FCM TOKEN LIFECYCLE                             │
└─────────────────────────────────────────────────────────────────┘

  User grants               Token saved            Periodic
  notification              to Firestore           refresh
  permission                                       check
       │                         │                    │
       ▼                         ▼                    ▼
  ┌─────────┐             ┌─────────────┐      ┌──────────┐
  │ Request │──── Yes ───▶│ Save token  │─────▶│ Refresh  │
  │ perms   │             │ to user doc │      │ on load  │
  └────┬────┘             └─────────────┘      └──────────┘
       │ No/Denied
       ▼
  ┌─────────────┐
  │ Store pref  │
  │ don't ask   │
  │ again       │
  └─────────────┘
```

### Token Registration

```typescript
// composables/usePushNotifications.ts
import { getMessaging, getToken, onMessage } from 'firebase/messaging'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY

export function usePushNotifications() {
  const messaging = getMessaging()
  const permissionStatus = ref<NotificationPermission>(Notification.permission)

  async function requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false

    const permission = await Notification.requestPermission()
    permissionStatus.value = permission

    if (permission === 'granted') {
      await registerToken()
      return true
    }

    // Store denial so we don't re-prompt
    localStorage.setItem('fcm_permission_denied', Date.now().toString())
    return false
  }

  async function registerToken() {
    try {
      const token = await getToken(messaging, { vapidKey: VAPID_KEY })

      if (!token) return

      const user = getCurrentUser()
      if (!user) return

      // Save token to user's Firestore document
      await setDoc(
        doc(db, `users/${user.uid}/fcmTokens/${token}`),
        {
          token,
          createdAt: serverTimestamp(),
          lastRefreshedAt: serverTimestamp(),
          userAgent: navigator.userAgent,
          platform: detectPlatform(), // 'web' | 'pwa-android' | 'pwa-ios'
        },
        { merge: true }
      )
    } catch (error) {
      console.error('Failed to get FCM token:', error)
    }
  }

  // Refresh token on every app load (tokens can rotate)
  async function refreshTokenIfNeeded() {
    if (Notification.permission !== 'granted') return

    try {
      const token = await getToken(messaging, { vapidKey: VAPID_KEY })
      if (!token) return

      const user = getCurrentUser()
      if (!user) return

      await updateDoc(
        doc(db, `users/${user.uid}/fcmTokens/${token}`),
        { lastRefreshedAt: serverTimestamp() }
      )
    } catch (error) {
      // Token may have been revoked — re-request
      console.warn('FCM token refresh failed, re-registering')
      await registerToken()
    }
  }

  // Handle foreground messages
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification ?? {}
    if (title) {
      // Show in-app toast instead of system notification
      useToast().info(body ?? title, { title })
    }
  })

  return { permissionStatus, requestPermission, refreshTokenIfNeeded }
}
```

### Firebase Messaging Service Worker

```javascript
// public/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.x/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.x/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: '...',
  projectId: 'runplan-pro',
  messagingSenderId: '...',
  appId: '...',
})

const messaging = firebase.messaging()

// Background message handler
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification ?? {}
  self.registration.showNotification(title ?? 'RunPlan Pro', {
    body,
    icon: icon ?? '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: payload.data,
  })
})
```

### Token Cleanup

Stale tokens (not refreshed in 60 days) are cleaned up by a scheduled Cloud Function:

```typescript
// Cloud Function: runs weekly
async function cleanupStaleFCMTokens() {
  const cutoff = Timestamp.fromDate(subDays(new Date(), 60))

  const usersSnapshot = await db.collection('users').get()

  for (const userDoc of usersSnapshot.docs) {
    const staleTokens = await db
      .collection(`users/${userDoc.id}/fcmTokens`)
      .where('lastRefreshedAt', '<', cutoff)
      .get()

    const batch = db.batch()
    staleTokens.docs.forEach(tokenDoc => batch.delete(tokenDoc.ref))
    await batch.commit()
  }
}
```

### Notification Types

| Type | Trigger | Title | Body Example |
|------|---------|-------|-------------|
| `workout_reminder` | Scheduled: morning of workout day | "Today's Workout" | "Easy Run — 8 km at 5:45-6:00/km" |
| `plan_adjusted` | After adaptive replanning | "Plan Updated" | "We've adjusted your plan based on this week's training." |
| `weekly_summary` | Scheduled: Sunday evening | "Weekly Summary" | "Great week! 4/4 workouts, 42 km total." |
| `goal_completed` | Race date passed or manual complete | "Training Complete!" | "Your Half Marathon training plan is done!" |
| `missed_workout` | 6h after missed cutoff | "Missed Workout" | "It looks like you missed today's tempo run. Your plan will adapt." |
| `strava_disconnected` | Strava token refresh fails 3x | "Strava Disconnected" | "Reconnect Strava to keep syncing workouts." |

### Permission Request Timing

Do **not** request notification permission immediately. Use this strategy:

1. **First session:** No prompt
2. **After completing onboarding:** Show contextual prompt on Dashboard: "Get reminders for your workouts?" with "Enable" and "Not now" buttons
3. **If "Not now":** Don't re-prompt for 7 days
4. **If denied at OS level:** Store denial, never re-prompt (respect the user's choice)

### Firestore Schema Addition

```typescript
// Subcollection: users/{userId}/fcmTokens/{token}
interface FCMToken {
  token: string
  createdAt: Timestamp
  lastRefreshedAt: Timestamp
  userAgent: string
  platform: 'web' | 'pwa-android' | 'pwa-ios'
}
```

---

## Operational Concerns

### 13.1 Strava API Rate Limiting

Strava enforces rate limits: **100 requests per 15 minutes** and **1,000 requests per day** per application.

**Strategy:**

```typescript
// services/stravaRateLimiter.ts
interface RateLimitState {
  short: { remaining: number; resetAt: number }  // 15-min window
  daily: { remaining: number; resetAt: number }   // daily window
}

class StravaRateLimiter {
  private state: RateLimitState

  // Update state from Strava response headers
  updateFromHeaders(headers: Headers) {
    this.state = {
      short: {
        remaining: parseInt(headers.get('X-RateLimit-Limit')?.split(',')[0] ?? '100')
          - parseInt(headers.get('X-RateLimit-Usage')?.split(',')[0] ?? '0'),
        resetAt: Date.now() + 15 * 60 * 1000,
      },
      daily: {
        remaining: parseInt(headers.get('X-RateLimit-Limit')?.split(',')[1] ?? '1000')
          - parseInt(headers.get('X-RateLimit-Usage')?.split(',')[1] ?? '0'),
        resetAt: endOfDay(new Date()).getTime(),
      },
    }
  }

  canMakeRequest(): boolean {
    return this.state.short.remaining > 5 && this.state.daily.remaining > 50
  }

  async waitIfNeeded(): Promise<void> {
    if (this.state.short.remaining <= 5) {
      const waitMs = this.state.short.resetAt - Date.now()
      if (waitMs > 0) await sleep(waitMs)
    }
  }
}
```

**Queue-based approach for Cloud Functions:**
- Strava webhook events are written to a Firestore `stravaEventQueue` collection
- A Cloud Function processes the queue with controlled concurrency (max 5 concurrent requests)
- Failed requests due to rate limiting are retried with exponential backoff (1min, 2min, 4min, max 15min)
- Daily limit approached (< 50 remaining): defer non-critical requests to next day

### 13.2 Strava Deauthorization Webhook

When a user revokes app access in Strava settings, Strava sends a `DELETE` webhook event.

```typescript
// Cloud Function: stravaWebhook (already exists, extend for deauth)
async function handleStravaWebhook(req: Request, res: Response) {
  const { object_type, aspect_type, owner_id } = req.body

  if (object_type === 'athlete' && aspect_type === 'update') {
    const { authorized } = req.body.updates

    if (authorized === 'false') {
      await handleStravaDeauthorization(owner_id)
    }
  }
  // ... existing activity webhook handling
}

async function handleStravaDeauthorization(stravaAthleteId: number) {
  // Find user by Strava athlete ID
  const userSnapshot = await db.collection('users')
    .where('stravaAthleteId', '==', stravaAthleteId)
    .limit(1)
    .get()

  if (userSnapshot.empty) return

  const userId = userSnapshot.docs[0].id

  // Clean up Strava data
  await db.doc(`users/${userId}`).update({
    stravaAthleteId: FieldValue.delete(),
    stravaUsername: FieldValue.delete(),
  })

  // Delete stored tokens
  await db.doc(`users/${userId}/stravaTokens/current`).delete()

  // Send notification to user
  await sendNotification(userId, {
    type: 'strava_disconnected',
    title: 'Strava Disconnected',
    body: 'Your Strava account has been disconnected. Reconnect to continue syncing workouts.',
  })
}
```

### 13.3 Historical Activity Import from Strava

When a user first connects Strava, import their recent activity history to improve baseline estimates.

**Flow:**
```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Strava       │───▶│ Fetch last   │───▶│ Calculate    │
│ Connected    │    │ 90 days of   │    │ baseline     │
│              │    │ activities   │    │ from history │
└──────────────┘    └──────────────┘    └──────────────┘
```

```typescript
// Cloud Function: triggered after Strava OAuth success
async function importStravaHistory(userId: string, stravaTokens: StravaTokens) {
  const ninetyDaysAgo = Math.floor(subDays(new Date(), 90).getTime() / 1000)

  let page = 1
  let allActivities: StravaActivity[] = []

  // Paginate through activities (Strava returns max 200 per page)
  while (true) {
    const activities = await stravaApi.getActivities(stravaTokens.accessToken, {
      after: ninetyDaysAgo,
      per_page: 200,
      page,
    })

    if (activities.length === 0) break

    // Only import running activities
    const runs = activities.filter(a => a.type === 'Run')
    allActivities.push(...runs)
    page++

    // Rate limit protection
    if (page > 5) break // Max 1000 activities
  }

  // Store activities
  const batch = db.batch()
  for (const activity of allActivities) {
    const activityRef = db.doc(`users/${userId}/activities/${activity.id}`)
    batch.set(activityRef, mapStravaActivity(activity))
  }
  await batch.commit()

  // Calculate baseline fitness from imported data
  await calculateBaselineFromHistory(userId, allActivities)
}
```

**UI indicator during import:**
- Dashboard shows: "Importing your Strava history..." with a progress indicator
- Once complete: "Imported 42 activities from the last 90 days."

### 13.4 GDPR Data Export & Deletion

#### Data Export

**Access:** Settings → Account → Export My Data

```typescript
// Cloud Function: HTTPS callable
async function exportUserData(userId: string): Promise<string> {
  const data: UserDataExport = {
    exportDate: new Date().toISOString(),
    profile: await getDoc(doc(db, `users/${userId}`)),
    settings: await getDoc(doc(db, `users/${userId}/settings/current`)),
    goals: [],
    activities: [],
  }

  // Collect all goals with workouts
  const goals = await db.collection(`users/${userId}/goals`).get()
  for (const goalDoc of goals.docs) {
    const workouts = await db.collection(`users/${userId}/goals/${goalDoc.id}/workouts`).get()
    data.goals.push({
      ...goalDoc.data(),
      workouts: workouts.docs.map(w => w.data()),
    })
  }

  // Collect all activities
  const activities = await db.collection(`users/${userId}/activities`).get()
  data.activities = activities.docs.map(a => a.data())

  // Upload as JSON to Cloud Storage (temporary, 7-day expiration)
  const fileName = `exports/${userId}/${Date.now()}-export.json`
  const file = storage.bucket().file(fileName)
  await file.save(JSON.stringify(data, null, 2), { contentType: 'application/json' })

  const [downloadUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  })

  // Send email with download link
  await sendEmail(data.profile.email, 'data-export', { downloadUrl })

  return downloadUrl
}
```

**UI flow:** Button triggers export → toast "Preparing your data..." → email sent with download link → toast "Export ready! Check your email."

#### Account Deletion

**Access:** Settings → Account → Delete Account

**Confirmation dialog:**
```
┌────────────────────────────────┐
│                                │
│   ⚠️ Delete Account?           │
│                                │
│   This will permanently        │
│   delete your account and      │
│   all associated data:         │
│                                │
│   • Training plans             │
│   • Workout history            │
│   • Activity data              │
│   • Settings                   │
│                                │
│   This action cannot be        │
│   undone.                      │
│                                │
│   Type "DELETE" to confirm:    │
│   ┌────────────────────────┐   │
│   │                        │   │
│   └────────────────────────┘   │
│                                │
│   ┌────────────────────────┐   │
│   │  Delete My Account     │   │
│   └────────────────────────┘   │
│   (destructive/red, disabled   │
│    until "DELETE" typed)        │
│                                │
│          Cancel                │
│                                │
└────────────────────────────────┘
```

```typescript
// Cloud Function: HTTPS callable
async function deleteUserAccount(userId: string) {
  // 1. Revoke Strava access
  const tokens = await getDoc(doc(db, `users/${userId}/stravaTokens/current`))
  if (tokens.exists()) {
    await stravaApi.deauthorize(tokens.data().accessToken)
  }

  // 2. Delete all Firestore data (recursive)
  await deleteCollection(db, `users/${userId}/activities`)
  const goals = await db.collection(`users/${userId}/goals`).get()
  for (const goalDoc of goals.docs) {
    await deleteCollection(db, `users/${userId}/goals/${goalDoc.id}/workouts`)
    await deleteCollection(db, `users/${userId}/goals/${goalDoc.id}/adjustments`)
    await goalDoc.ref.delete()
  }
  await deleteCollection(db, `users/${userId}/fcmTokens`)
  await db.doc(`users/${userId}`).delete()

  // 3. Delete Cloud Storage exports
  await storage.bucket().deleteFiles({ prefix: `exports/${userId}/` })

  // 4. Delete Firebase Auth account
  await admin.auth().deleteUser(userId)
}
```

**Data retention:** All user data is deleted immediately. No grace period (simplifies compliance). Users are warned in the confirmation dialog.

### 13.5 Monitoring & Observability

#### Firebase-Native Monitoring

| Tool | Purpose | Configuration |
|------|---------|--------------|
| **Firebase Crashlytics** | N/A (web only, not supported) | — |
| **Firebase Performance Monitoring** | Page load times, network latency | Auto-instrumented via SDK |
| **Cloud Functions Logs** | Function execution, errors | `functions.logger.info/warn/error` |
| **Firebase Analytics** | User events, screen views | Custom events via `logEvent()` |
| **Cloud Monitoring Alerts** | Function errors, latency spikes | Alerting policies |

#### Custom Analytics Events

```typescript
// analytics/events.ts
const ANALYTICS_EVENTS = {
  // Onboarding
  onboarding_started: {},
  onboarding_completed: { goal_type: string, plan_weeks: number },
  onboarding_abandoned: { step: number },

  // Training
  workout_viewed: { workout_type: string, status: string },
  workout_skipped: { workout_type: string, reason?: string },
  workout_completed: { workout_type: string, score: number },
  plan_adjusted: { reason: string, changes_count: number },

  // Engagement
  strava_connected: {},
  strava_disconnected: { reason: string },
  notifications_enabled: {},
  notifications_disabled: {},
  goal_completed: { goal_type: string, compliance: number },
  goal_abandoned: { goal_type: string, reason?: string, weeks_completed: number },

  // Errors
  api_error: { endpoint: string, error_code: string },
  strava_sync_failed: { error: string },
}
```

#### Cloud Function Error Alerts

```typescript
// Set up in Google Cloud Console or via Terraform/Pulumi:
// Alert policy: Cloud Function error rate > 5% over 5 minutes
// Alert policy: Cloud Function p99 latency > 10s
// Alert policy: Daily Strava API quota > 80%
// Notification channel: Email + optional Slack webhook
```

#### Health Check Endpoint

```typescript
// Cloud Function: healthCheck
export const healthCheck = onRequest(async (req, res) => {
  const checks = {
    firestore: await checkFirestore(),
    strava: await checkStravaApi(),
    timestamp: new Date().toISOString(),
  }

  const allHealthy = Object.values(checks).every(c =>
    typeof c === 'string' || c.status === 'ok'
  )

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
  })
})
```

### 13.6 Email Templates

RunPlan Pro sends transactional emails via Firebase Authentication (for auth flows) and a custom solution for app emails.

**Recommended approach:** Firebase Extensions — "Trigger Email" with SendGrid/Mailgun, or use Firebase Auth's built-in email templates for auth flows.

#### Email Types

| Email | Trigger | Template |
|-------|---------|----------|
| **Welcome** | After registration | Welcome message + quick-start tips |
| **Password Reset** | User requests reset | Firebase Auth default (customizable in console) |
| **Email Verification** | After registration (if enabled) | Firebase Auth default |
| **Weekly Summary** | Scheduled: Sunday evening | Training stats, upcoming week preview |
| **Data Export Ready** | After GDPR export | Download link (expires in 7 days) |
| **Strava Disconnected** | Deauth or token failure | Re-connect CTA |
| **Goal Completed** | Race date reached | Congratulations + summary stats |
| **Inactivity Reminder** | No activity for 14 days | Encouragement + plan status |

#### Firebase Auth Email Customization

Customize in Firebase Console → Authentication → Templates:
- **Sender name:** "RunPlan Pro"
- **Sender email:** `noreply@runplanpro.com` (or custom domain)
- **Action URL:** `https://app.runplanpro.com/auth/action`

### 13.7 Accessibility (a11y)

#### Standards

Target **WCAG 2.1 Level AA** compliance.

#### Key Requirements

| Area | Requirement | Implementation |
|------|------------|----------------|
| **Color contrast** | Min 4.5:1 for text, 3:1 for large text | Verify all Vuiii theme colors; test with axe-core |
| **Keyboard navigation** | All interactive elements focusable and operable | Use semantic HTML (`<button>`, `<a>`, `<input>`). Tab order follows visual order. |
| **Screen readers** | Meaningful labels for all controls | `aria-label` on icon-only buttons. `aria-live` regions for dynamic content (toasts, score updates). |
| **Focus indicators** | Visible focus ring on all interactive elements | Vuiii default focus styles; verify custom components |
| **Motion** | Respect `prefers-reduced-motion` | Disable animations when system preference set |
| **Touch targets** | Min 44×44 px for touch targets | Verify all buttons and tappable areas |
| **Form errors** | Errors announced to screen readers | `aria-invalid`, `aria-describedby` linking to error messages |
| **Charts** | Data accessible without vision | Alt text on chart images; tabular fallback for screen readers |

#### Testing

- **Automated:** axe-core via `@axe-core/playwright` in E2E tests
- **Manual:** VoiceOver (macOS/iOS), TalkBack (Android) testing before each release
- **CI check:** `eslint-plugin-vuejs-accessibility` in lint step

```typescript
// eslint.config.js addition
import vueA11y from 'eslint-plugin-vuejs-accessibility'

export default [
  // ... existing config
  {
    plugins: { 'vuejs-accessibility': vueA11y },
    rules: {
      'vuejs-accessibility/alt-text': 'error',
      'vuejs-accessibility/anchor-has-content': 'error',
      'vuejs-accessibility/click-events-have-key-events': 'error',
      'vuejs-accessibility/form-control-has-label': 'error',
      'vuejs-accessibility/label-has-for': 'error',
      'vuejs-accessibility/no-autofocus': 'warn',
    },
  },
]
```

---

## Appendix: Workout Type Definitions

```typescript
type WorkoutType = 'easy' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'race'

const WORKOUT_CONFIGS: Record<WorkoutType, WorkoutConfig> = {
  easy: {
    name: 'Easy Run',
    icon: '🏃',
    paceZone: 'Z2',
    heartRateZone: 2,
    description: 'Comfortable conversational pace',
    color: '#4CAF50'
  },
  long: {
    name: 'Long Run',
    icon: '🏃‍♂️',
    paceZone: 'Z2',
    heartRateZone: 2,
    description: 'Building endurance at easy pace',
    color: '#2196F3'
  },
  tempo: {
    name: 'Tempo Run',
    icon: '⚡',
    paceZone: 'Z3-Z4',
    heartRateZone: 3,
    description: 'Comfortably hard, sustained effort',
    color: '#FF9800'
  },
  intervals: {
    name: 'Intervals',
    icon: '🔥',
    paceZone: 'Z4-Z5',
    heartRateZone: 4,
    description: 'High intensity with recovery periods',
    color: '#F44336'
  },
  recovery: {
    name: 'Recovery Run',
    icon: '🧘',
    paceZone: 'Z1',
    heartRateZone: 1,
    description: 'Very easy, active recovery',
    color: '#9C27B0'
  },
  race: {
    name: 'Race',
    icon: '🏆',
    paceZone: 'Race Pace',
    heartRateZone: 4,
    description: 'Your goal race!',
    color: '#FFD700'
  }
}
```

---

*— End of Implementation Specification —*
