# Product Requirements Document

# RunPlan Pro

*Adaptive Training Plans for Runners*

**Version 1.1 | January 2026**

---

## Executive Summary

RunPlan Pro is a web application designed to help runners achieve their goals by providing personalized, adaptive training plans. The app integrates with Strava to automatically track training progress, detect missed workouts, and dynamically adjust the training plan to keep athletes on track toward their goals.

The core differentiator is intelligent plan adaptation: rather than providing a static schedule, RunPlan Pro continuously recalculates the optimal path to the goal based on actual performance, life circumstances, and recovery needs.

---

## Problem Statement

Traditional training plans fail runners in several ways: they assume perfect adherence, ignore real-world performance data, and leave athletes guessing when life disrupts their schedule. Runners who miss workouts often either skip them entirely (losing fitness gains) or try to "make up" sessions inappropriately (risking injury).

- Static plans cannot adapt to missed workouts, illness, or schedule changes
- Manual tracking creates friction and reduces engagement
- Progress toward goals is difficult to visualize and understand
- Runners lack guidance on how to recover from setbacks without abandoning their goals

---

## Target Users

Primary audience: recreational runners (5K to marathon distance) who want structured training but need flexibility. These users typically run 3-5 times per week, have busy lives with competing priorities, and use Strava to log their activities.

| User Segment | Characteristics | Primary Needs |
|--------------|-----------------|---------------|
| Goal-Oriented Beginner | Training for first race, limited running experience, needs guidance | Clear structure, achievable milestones, injury prevention |
| Busy Enthusiast | Experienced runner, irregular schedule, high motivation | Flexible plans, efficient workouts, seamless tracking |
| PR Chaser | Competitive amateur, data-driven, trains regularly | Performance optimization, detailed analytics, pace targets |

---

## Core Features

### 1. Goal Configuration

Users define their training goal through a guided onboarding flow:

- Race type: 5K, 10K, Half Marathon, Marathon, or custom distance
- Race date: specific date or flexible window
- Target time: finish time goal or "just finish" option
- Current fitness: assessed via recent Strava data or self-reported recent race
- Available training days: weekly schedule preferences
- Constraints: injury history, maximum weekly mileage, time per session

### 2. Intelligent Plan Generation

The system generates a personalized training plan based on established training principles:

- Progressive overload with appropriate weekly mileage increases (max 10%)
- Periodization: base building, speed work, tapering phases
- Workout variety: easy runs, long runs, tempo, intervals, recovery
- Rest day placement based on user schedule and workout intensity
- Calculated pace targets based on goal time and current fitness

### 3. Strava Integration

Seamless two-way integration with Strava via webhook API:

- OAuth 2.0 authentication for secure account linking
- Webhook subscription for real-time activity notifications
- Automatic activity matching: completed runs matched to scheduled workouts
- Performance analysis: actual pace, distance, heart rate vs. planned
- Historical data import for initial fitness assessment
- Planned workout export to Strava (description with targets)

### 4. Adaptive Plan Adjustment

The core innovation: dynamic plan recalculation based on real-world data.

#### Missed Workout Handling

When a scheduled workout is not completed:

1. **Detection**: workout window passes without matching Strava activity
2. **Classification**: determine workout importance (key workout vs. easy run)
3. **User prompt**: optional reason input (illness, injury, schedule conflict, rest needed)
4. **Replanning**: algorithm adjusts future workouts based on context
5. **Communication**: clear explanation of what changed and why

#### Adjustment Strategies

| Scenario | Impact Assessment | Plan Adjustment |
|----------|-------------------|-----------------|
| Single easy run missed | Low impact, common occurrence | Absorb loss, no schedule change |
| Key workout missed | Medium impact, affects progression | Reschedule within 48-72 hours if possible, adjust intensity of adjacent workouts |
| Long run missed | High impact for endurance goals | Extend next long run cautiously, add mid-week medium-long run |
| Multiple consecutive days | Significant setback, fitness regression | Reduce upcoming week volume by 20-30%, rebuild gradually |
| Illness/Injury reported | Recovery priority over training | Full rest period, gradual return protocol, possible goal adjustment |

#### Performance-Based Adjustments

Beyond missed workouts, the plan adapts to actual performance:

- Consistently exceeding pace targets → increase training paces, potentially upgrade goal time
- Struggling with prescribed paces → adjust targets, increase easy run proportion
- Heart rate data anomalies → flag potential overtraining, suggest extra recovery
- Race result input → recalibrate entire training system based on actual performance

### 5. Dashboard & Progress Tracking

A clear, motivating interface that shows progress and upcoming work:

- Calendar view with completed, upcoming, and adapted workouts
- Goal progress visualization: time remaining, fitness trajectory, predicted race time
- Weekly summary: planned vs. actual mileage, compliance rate
- Trend charts: weekly volume, pace improvements, consistency score
- Notifications: workout reminders, achievements, plan adjustments

---

## Technical Architecture

### Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| **Frontend** | Vue.js 3 | Composition API, TypeScript |
| **UI Framework** | Vuiii | Lightweight Vue 3 component library (`vuiii@beta`) |
| **Firebase Integration** | VueFire | Official Firebase bindings for Vue with real-time sync |
| **State Management** | Pinia + VueFire | VueFire handles Firestore state; Pinia for app-level state |
| **Backend** | Firebase | Serverless architecture |
| **Database** | Cloud Firestore | NoSQL document database |
| **Authentication** | Firebase Auth | With Strava OAuth provider |
| **Functions** | Cloud Functions | Node.js runtime for webhooks and background processing |
| **Hosting** | Firebase Hosting | CDN-backed static hosting |
| **Push Notifications** | Firebase Cloud Messaging | Cross-platform notifications |

### Why VueFire?

VueFire provides first-class Firebase integration for Vue 3:

- **Declarative data binding**: Automatically syncs Firestore documents/collections to reactive refs
- **SSR support**: Works with Nuxt if needed later
- **Composables**: `useDocument()`, `useCollection()`, `useFirebaseAuth()` for clean Composition API usage
- **Automatic subscription management**: Cleans up listeners when components unmount
- **TypeScript support**: Full type inference for Firestore data

### Mobile-First Design Principles

The UI is designed with a mobile-first approach, recognizing that runners primarily interact with the app on their phones:

- **Touch-optimized controls**: Large tap targets (minimum 48px), swipe gestures for navigation
- **Bottom navigation**: Primary actions accessible with thumb reach
- **Progressive disclosure**: Essential information first, details on demand
- **Offline capability**: Service workers for viewing plans without connectivity
- **Responsive breakpoints**: Mobile (< 600px) → Tablet (600-1024px) → Desktop (> 1024px)
- **Performance budget**: First contentful paint < 1.5s on 3G connection
- **Vuiii utilities**: Leverage built-in responsive helpers for adaptive layouts

### Frontend Architecture

```
src/
├── assets/                 # Static assets, icons
├── components/
│   ├── common/            # Shared components (AppBar, BottomNav)
│   ├── calendar/          # Calendar and schedule views
│   ├── workout/           # Workout cards, details, completion
│   ├── progress/          # Charts, metrics, visualizations
│   └── onboarding/        # Goal setup flow
├── composables/           # Reusable composition functions
│   ├── useStrava.ts       # Strava API interactions
│   ├── usePlan.ts         # Training plan operations (uses VueFire)
│   └── useAuth.ts         # Authentication state (uses VueFire)
├── layouts/
│   ├── DefaultLayout.vue  # Main app shell
│   └── OnboardingLayout.vue
├── pages/                 # Route-based views
│   ├── index.vue          # Dashboard/home
│   ├── calendar.vue       # Training calendar
│   ├── workout/[id].vue   # Workout detail
│   ├── progress.vue       # Analytics
│   └── settings.vue       # User preferences
├── plugins/
│   ├── vuiii.ts           # Vuiii UI configuration
│   └── firebase.ts        # Firebase + VueFire initialization
├── stores/                # Pinia stores (non-Firebase state)
│   └── ui.ts              # UI state (modals, navigation)
└── types/                 # TypeScript definitions
```

### Firebase Architecture

```
firestore/
├── users/
│   └── {userId}/
│       ├── profile          # User settings, preferences
│       ├── stravaTokens     # Encrypted OAuth tokens
│       ├── goals/           # Subcollection of training goals
│       │   └── {goalId}/
│       │       ├── plan     # Generated training plan
│       │       ├── workouts/ # Scheduled workouts
│       │       └── adjustments/ # Audit log of plan changes
│       │           └── {adjustmentId}
│       └── activities/      # Subcollection of synced Strava activities
│           └── {activityId}
│
└── webhookSubscriptions/
    └── {subscriptionId}     # Strava webhook subscription records

functions/
├── strava/
│   ├── webhook.ts          # Webhook receiver (activity.create, activity.update)
│   ├── oauth.ts            # OAuth callback handler
│   └── sync.ts             # Activity data fetcher
├── planning/
│   ├── generate.ts         # Initial plan generation
│   ├── adapt.ts            # Adaptive replanning logic
│   └── match.ts            # Activity-to-workout matching
└── notifications/
    └── send.ts             # Push notification dispatcher
```

### Strava Integration Flow

1. User initiates Strava connection via Firebase Auth custom OAuth flow
2. Backend exchanges code for access/refresh tokens, stores encrypted in Firestore
3. Cloud Function registers webhook subscription with Strava API
4. When activity is created/updated, Strava POSTs to Cloud Function endpoint
5. Function validates webhook signature, queues processing task
6. Background function fetches full activity details using stored tokens
7. Activity matched against scheduled workout in user's plan
8. Planning engine evaluates if adaptation needed, updates Firestore
9. Firestore listeners trigger UI update; FCM sends push notification if significant change

### Key Data Models

```typescript
interface User {
  id: string;
  email: string;
  stravaAthleteId?: number;
  preferences: {
    units: 'metric' | 'imperial';
    notifications: boolean;
    defaultTrainingDays: number[];
  };
  createdAt: Timestamp;
}

interface Goal {
  id: string;
  userId: string;
  raceType: '5k' | '10k' | 'half' | 'marathon' | 'custom';
  raceDate: Timestamp;
  targetTime?: number; // seconds
  status: 'active' | 'completed' | 'abandoned';
  currentPhase: 'base' | 'build' | 'peak' | 'taper';
  createdAt: Timestamp;
}

interface ScheduledWorkout {
  id: string;
  goalId: string;
  date: Timestamp;
  type: 'easy' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'race';
  plannedDistance: number; // meters
  plannedDuration?: number; // seconds
  targetPace?: { min: number; max: number }; // sec/km
  intervals?: IntervalSet[];
  status: 'scheduled' | 'completed' | 'missed' | 'skipped';
  matchedActivityId?: string;
  adaptedFrom?: string; // original workout ID if rescheduled
}

interface CompletedActivity {
  id: string;
  stravaId: number;
  userId: string;
  matchedWorkoutId?: string;
  distance: number;
  duration: number;
  averagePace: number;
  averageHeartRate?: number;
  startTime: Timestamp;
  performanceScore?: number; // vs. planned targets
}

interface PlanAdjustment {
  id: string;
  goalId: string;
  triggeredBy: 'missed_workout' | 'performance' | 'user_request' | 'illness';
  description: string;
  changes: WorkoutChange[];
  acknowledged: boolean;
  createdAt: Timestamp;
}
```

---

## MVP Scope

Initial release focuses on core value proposition with limited scope:

**Included in MVP:**

- Single goal support (one active training plan at a time)
- Race distances: 5K, 10K, Half Marathon, Marathon
- Strava integration (required, no manual entry)
- Basic adaptive replanning for missed workouts
- Mobile-first Vue.js PWA with Vuiii components
- Firebase backend with VueFire real-time bindings
- Push notifications for plan changes

**Post-MVP considerations:**

- Native mobile apps (iOS, Android) via Capacitor
- Additional integrations (Garmin Connect, Apple Health, Polar)
- Multiple concurrent goals
- Social features (challenges, sharing)
- Coach/athlete relationship features
- AI-powered workout suggestions and race predictions
- Offline-first with background sync

---

## Success Metrics

| Metric | Target (6 months) | Measurement |
|--------|-------------------|-------------|
| Plan completion rate | >60% of users complete training plan | Users reaching race day with plan active |
| Weekly engagement | >80% of active users log activity weekly | Strava sync events per user per week |
| Adaptation acceptance | >90% plan changes accepted | User acknowledgment of suggested changes |
| Goal achievement | >70% finish race within goal range | Self-reported race results vs. target |
| NPS | >50 | Post-race survey |
| Mobile usage | >75% of sessions on mobile | Firebase Analytics |
| Performance | <2s time to interactive on 4G | Lighthouse scores |

---

## Risks & Mitigations

- **Strava API dependency**: Rate limits, terms changes, or deprecation could impact service. *Mitigation*: build abstraction layer, monitor API health, explore backup integrations.

- **Plan adaptation quality**: Poor algorithm decisions could frustrate users or cause injury. *Mitigation*: conservative defaults, expert review, user override options, clear explanations.

- **User privacy concerns**: Fitness data is sensitive. *Mitigation*: minimal data collection, clear privacy policy, data export/deletion options, GDPR compliance, Firebase security rules.

- **Competitive landscape**: TrainingPeaks, Runna, and others have established market presence. *Mitigation*: focus on adaptation intelligence as differentiator, freemium model for adoption.

- **Firebase costs at scale**: Pay-per-use can become expensive. *Mitigation*: optimize Firestore reads with caching, use Firebase Extensions where possible, monitor usage closely.

---

## Proposed Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **Phase 1: Foundation** | Weeks 1-4 | Firebase project setup, Firestore schema, Firebase Auth with Strava OAuth, basic Vue/Vuiii shell with mobile navigation |
| **Phase 2: Core Features** | Weeks 5-8 | Plan generation Cloud Function, goal configuration UI, calendar component with workout cards |
| **Phase 3: Integration** | Weeks 9-12 | Strava webhook Cloud Function, activity matching, missed workout detection, adaptive replanning v1 |
| **Phase 4: Polish** | Weeks 13-14 | Dashboard with charts, progress visualization, FCM notifications, PWA configuration |
| **Phase 5: Launch** | Weeks 15-16 | Beta testing, performance optimization, Lighthouse audit, production deployment |

---

## Development Environment

### Prerequisites

- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- Vite

### Local Setup

```bash
# Clone repository
git clone https://github.com/org/runplan-pro.git
cd runplan-pro

# Install dependencies
npm install

# Firebase emulators for local development
firebase emulators:start

# Run dev server
npm run dev
```

### Firebase + VueFire Configuration

```typescript
// src/plugins/firebase.ts
import { VueFire, VueFireAuth } from 'vuefire'
import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import type { App } from 'vue'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseApp = initializeApp(firebaseConfig)
export const db = getFirestore(firebaseApp)
export const functions = getFunctions(firebaseApp)
export const auth = getAuth(firebaseApp)

// Connect to emulators in development
if (import.meta.env.DEV) {
  connectFirestoreEmulator(db, 'localhost', 8080)
  connectFunctionsEmulator(functions, 'localhost', 5001)
  connectAuthEmulator(auth, 'http://localhost:9099')
}

// Vue plugin setup
export function setupFirebase(app: App) {
  app.use(VueFire, {
    firebaseApp,
    modules: [
      VueFireAuth(),
    ],
  })
}
```

### VueFire Usage Examples

```typescript
// composables/usePlan.ts
import { computed } from 'vue'
import { useDocument, useCollection } from 'vuefire'
import { doc, collection, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/plugins/firebase'
import { useCurrentUser } from 'vuefire'

export function usePlan() {
  const user = useCurrentUser()

  // Reactive reference to active goal - auto-syncs with Firestore
  const activeGoalRef = computed(() =>
    user.value
      ? doc(db, 'users', user.value.uid, 'goals', 'active')
      : null
  )
  const { data: activeGoal, pending: goalLoading } = useDocument(activeGoalRef)

  // Reactive collection of upcoming workouts
  const workoutsQuery = computed(() => {
    if (!user.value || !activeGoal.value) return null
    return query(
      collection(db, 'users', user.value.uid, 'goals', activeGoal.value.id, 'workouts'),
      where('status', '==', 'scheduled'),
      orderBy('date', 'asc')
    )
  })
  const { data: upcomingWorkouts, pending: workoutsLoading } = useCollection(workoutsQuery)

  return {
    activeGoal,
    upcomingWorkouts,
    loading: computed(() => goalLoading.value || workoutsLoading.value)
  }
}
```

```vue
<!-- pages/calendar.vue -->
<script setup lang="ts">
import { usePlan } from '@/composables/usePlan'

const { activeGoal, upcomingWorkouts, loading } = usePlan()
</script>

<template>
  <div class="calendar-page">
    <LoadingSpinner v-if="loading" />
    <template v-else>
      <GoalHeader :goal="activeGoal" />
      <WorkoutCalendar :workouts="upcomingWorkouts" />
    </template>
  </div>
</template>
```

### Vuiii Configuration

Vuiii is a lightweight Vue 3 UI component library (currently in beta).

```typescript
// src/plugins/vuiii.ts
// Note: Adjust imports based on the specific components needed from vuiii
import type { App } from 'vue'

// Import Vuiii styles
import 'vuiii/style.css'

// Import components as needed (tree-shakable)
// Example component imports - adjust based on actual vuiii exports:
// import { Button, Card, Input, Modal, ... } from 'vuiii'

```bash
# Install vuiii (use beta tag for latest features)
npm install vuiii@beta
```

### Main App Entry

```typescript
// src/main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { setupFirebase } from './plugins/firebase'
import router from './router'
import App from './App.vue'

// Vuiii styles
import 'vuiii/style.css'

// App styles (CSS custom properties for theming)
import './assets/main.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
setupFirebase(app)

app.mount('#app')
```

### App Theme Variables

```css
/* src/assets/main.css */
:root {
  /* Brand colors */
  --color-primary: #2D5A27;
  --color-secondary: #FF6B35;
  --color-accent: #4ECDC4;

  /* Surfaces */
  --color-background: #FAFAFA;
  --color-surface: #FFFFFF;

  /* Feedback */
  --color-error: #E53935;
  --color-success: #43A047;
  --color-warning: #FB8C00;

  /* Typography */
  --font-family: 'Inter', system-ui, sans-serif;

  /* Spacing scale */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;

  /* Border radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-full: 9999px;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #4CAF50;
    --color-background: #121212;
    --color-surface: #1E1E1E;
  }
}

/* Mobile-first base styles */
* {
  -webkit-tap-highlight-color: transparent;
}

button, a, [role="button"] {
  min-height: 48px; /* Touch target size */
  min-width: 48px;
}
```

---

*— End of Document —*
