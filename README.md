# Chrono — Personal Cloud Time Tracker

A production-ready personal time-tracking web application crafted with an Apple-inspired Liquid Glass design language, private Supabase authentication, PostgreSQL storage with Row Level Security (RLS), and zero-config deployment on Vercel.

---

## Architecture & Features

- **Frontend**: React 19, TypeScript 5.7, Vite 6
- **Styling**: Apple-inspired Liquid Glass design system (pure CSS tokens + custom displacement refraction shaders)
- **Immersive Full-Screen Clock**: Browser Fullscreen API with seamless CSS overlay fallback, animated SVG progress ring for countdown timers, overtime counter, Screen Wake Lock API, and keyboard shortcuts (`Space` to toggle, `Esc` to exit, `R` to discard).
- **Typography & Display Styles**: Independent selectors for Application Font and Clock Digit Font (Inter, Manrope, Space Grotesk, JetBrains Mono) plus 3 Clock Display Styles (Clean, Digital, Rounded) with live settings previews.
- **Configurable Sidebar**: Expanded (full labels), Compact (icon rail with tooltips), and Hidden (maximum canvas with sticky restore toggle) modes.
- **Persistent Storage**: Supabase PostgreSQL (UTC timezone-aware timestamps)
- **Security**: Supabase Auth (Email/Password & Google OAuth 2.0) + strict Row Level Security (RLS) enforcing `auth.uid() = user_id`
- **Email Authenticity**: Multi-layered defense preventing fake, disposable, temporary, and placeholder emails both client-side and at the PostgreSQL database level.
- **Hosting**: Vercel (Edge network, SPA fallback via `vercel.json`)
- **Local Fallback**: Full local-first capability with `localStorage` (`chrono-v1`)

---

## 1. Local Development Instructions

### Prerequisites
- Node.js 18+ (tested on Node 22 LTS)
- npm 9+

### Setup Steps
1. Clone or navigate to the repository:
   ```bash
   cd chrono-personal
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create your local environment configuration:
   ```bash
   cp .env.example .env.local
   ```
4. Start the development server (configured to listen on `0.0.0.0` for local network access):
   ```bash
   npm run dev
   ```
5. Open [http://localhost:5173](http://localhost:5173) in your browser.

### Local Wi-Fi / Multi-Device Access
The development server automatically binds to `0.0.0.0:5173` and logs your machine's active local IPv4 network address (e.g., `http://<your-wifi-ip>:5173`) upon startup. You can open that exact URL on any other computer, tablet, or phone connected to the same Wi-Fi network.

> [!NOTE]
> If `.env.local` is omitted or contains placeholder values, Chrono automatically runs in **Local Storage Mode** without crashing. You can use the timer, full-screen mode, typography customizer, analytics, calendar, and CSV/JSON exports immediately.

---

## 2. Supabase Project Setup

1. Create a free account at [supabase.com](https://supabase.com).
2. Click **New Project**:
   - Choose a project name (e.g., `chrono-personal`).
   - Generate a strong database password (store it safely).
   - Select your preferred region.
3. Once provisioned, navigate to **Project Settings** -> **API**:
   - Copy the **Project URL** (`https://<project-ref>.supabase.co`).
   - Copy the **Project API Keys** -> `anon` / `public` key.
   *(Never use the `service_role` key in frontend code or Git)*.

---

## 3. SQL Migrations & Database Setup

Apply the version-controlled SQL migrations located in `supabase/migrations/`:

### Step-by-step SQL Execution
1. In your Supabase Dashboard, open the **SQL Editor** tab from the left sidebar.
2. Click **New query**.
3. Copy and run the entire contents of [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql):
   - Creates the `categories`, `sessions`, and `user_preferences` tables.
   - Enforces unique constraints on `(user_id, local_id)` for idempotent deduplication.
   - Configures UTC `TIMESTAMPTZ` columns and automatic `updated_at` triggers.
   - Builds query indexes for fast history and analytics queries.
4. Open a second query and execute [`supabase/migrations/002_rls_policies.sql`](supabase/migrations/002_rls_policies.sql):
   - Enables and enforces Row Level Security on all tables.
   - Adds strict policies allowing only `auth.uid() = user_id` for SELECT, INSERT, UPDATE, and DELETE.
5. Open a third query and execute [`supabase/migrations/003_authentic_emails.sql`](supabase/migrations/003_authentic_emails.sql):
   - Enforces authentic emails at the PostgreSQL database level.
   - Rejects disposable/temporary email domains (Mailinator, TempMail, 10MinuteMail, GuerrillaMail, Yopmail, TrashMail, etc.).
   - Rejects dummy and placeholder names and domains directly on `auth.users` before registration.

---

## 4. Authentication Setup, Google OAuth & Hardening

### Email/Password & Email Authenticity
1. In Supabase Dashboard, navigate to **Authentication** -> **Providers**:
   - Verify that **Email** is enabled.
2. In Chrono, email registration strictly validates authenticity:
   - **Disposable Domains Blocked**: Blocks over 100+ burner email providers (Mailinator, 10MinuteMail, Temp-Mail, GuerrillaMail, YOPmail, TrashMail, etc.).
   - **Placeholder & Test Domains Blocked**: Blocks `example.com`, `test.com`, `fake.com`, `dummy.com`, `asdf.com`, etc.
   - **Random Gibberish Blocked**: Blocks keyboard walks (e.g. `asdfghjk`), long consonant-only local-parts, repetitive characters (e.g. `aaaaaa`), and dummy usernames.
   - **Server-Side Enforcement**: `supabase/migrations/003_authentic_emails.sql` runs a PostgreSQL trigger on `auth.users` to guarantee that API requests cannot bypass authenticity checks.

### Google OAuth 2.0 Setup
Chrono includes a Liquid Glass "Continue with Google" button powered by Supabase OAuth:
1. Go to [Google Cloud Console](https://console.cloud.google.com/) -> **APIs & Services** -> **Credentials**.
2. Click **Create Credentials** -> **OAuth Client ID**:
   - Application type: **Web application**.
   - Name: `Chrono Time Tracker`.
   - Authorized JavaScript origins:
     - `http://localhost:5173`
     - `https://your-chrono.vercel.app` (or your domain)
   - Authorized redirect URIs:
     - `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
3. Copy the generated **Client ID** and **Client Secret**.
4. In **Supabase Dashboard** -> **Authentication** -> **Providers** -> **Google**:
   - Toggle **Enable Google provider** to **ON**.
   - Paste your **Client ID** and **Client Secret**.
   - Click **Save**.
5. In **Authentication** -> **URL Configuration**:
   - Set **Site URL** to your production Vercel URL (e.g. `https://your-chrono.vercel.app`) or `http://localhost:5173` for local testing.
   - Under **Redirect URLs**, add:
     - `http://localhost:5173/**`
     - `https://*.vercel.app/**`
     - `https://your-custom-domain.com/**` (if using a custom domain)

### Disabling Public Sign-ups (Personal Mode)
To restrict Chrono strictly to yourself:
1. First, create your account in your deployed Chrono app by registering with your email and password.
2. Confirm your email if confirmation is enabled.
3. In Supabase Dashboard -> **Authentication** -> **Configuration** -> **Sign In / Up**:
   - Toggle **Enable email signups** to **OFF**.
4. Save changes. No one else can register an account, while you can continue signing in securely across all your devices.

---

## 5. UX Customization Guide

### Immersive Full-Screen Clock
- Click the **Full screen** icon (`Maximize2`) on the main clock card or embedded control strip.
- Uses browser Fullscreen API with graceful CSS overlay fallback.
- Features large tabular digits, timer countdown progress ring, status indicator, and overtime tracker.
- **Keyboard Shortcuts**:
  - `Space`: Start / Pause / Resume
  - `Esc`: Exit full-screen
  - `R`: Discard / Reset (when stopped or paused)
- Uses the **Screen Wake Lock API** during active sessions so your display won't sleep.

### Typography Customization
Navigate to **Settings -> Preferences**:
- **Application Font**: Choose from `Inter`, `Manrope`, `Space Grotesk`, or `JetBrains Mono` with live sample cards.
- **Clock Digit Font**: Independently style timer and stopwatch numerals.
- **Clock Display Style**: Choose `Clean` (minimal sans-serif), `Digital` (technical with accent glow), or `Rounded` (soft geometry).
- All preferences persist in browser storage and sync seamlessly across reloads.

### Sidebar Visibility Modes
- **Expanded**: Full navigation with labels and brand identity.
- **Compact**: 58px icon rail with native hover tooltips.
- **Hidden**: Removes the sidebar completely to maximize study space. A sticky restore button in the header brings it back instantly.
- Toggle between modes using the controls in the sidebar header or from **Settings -> Sidebar navigation**.

---

## 6. Required Environment Variables

Configure these in `.env.local` for local development, and in the **Vercel Dashboard** under **Settings -> Environment Variables**:

| Variable | Description | Example |
|---|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL | `https://xyzproject.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public `anon` API key | `eyJhbGciOi...` |

> [!CAUTION]
> Never expose the Supabase `service_role` secret key in client code. Only use the `anon` publishable key.

---

## 7. Vercel Deployment Instructions

1. Push your Chrono repository to GitHub (or import directly to Vercel).
2. Go to [vercel.com](https://vercel.com) and click **Add New** -> **Project**.
3. Select your Chrono repository.
4. Verify the Framework Preset is set to **Vite**:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = `https://<your-project>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `<your-anon-key>`
6. Click **Deploy**.
7. Vercel automatically deploys your project with SPA routing and asset caching configured via `vercel.json`.

---

## 8. Local Data Migration & Backups

### Local to Cloud Migration
1. When you sign in to your new Chrono account for the first time, Chrono automatically detects your browser records.
2. An **Import your existing data** dialog appears, displaying the exact count of sessions and categories found.
3. Click **Import to cloud**: original timestamps, categories, and durations are preserved with zero duplicates.

### Exporting Backups
- **CSV Export**: In **History** or **Settings**, click **Export CSV**. Generates `chrono-history.csv` with dates, times, durations, categories, subcategories, sources, and notes.
- **JSON Full Backup**: In **History** or **Settings**, click **Export JSON**. Generates `chrono-backup.json` containing complete session history, category definitions, and appearance preferences.

---

## 9. Testing & Quality Checks

Run the automated test suite locally:
```bash
npm test
```
Runs 6 automated test suites verifying:
- Stopwatch & countdown timer calculations
- Exclusion of paused time from study duration
- Idempotent migration & duplicate record prevention
- CSV and JSON backup formatting
- SQL migration and RLS policy integrity
- UX typography options, clock styles, sidebar modes & progress ring math
- Vercel configuration validity

To run a production build:
```bash
npm run build
```
