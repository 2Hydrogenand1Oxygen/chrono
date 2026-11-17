-- ============================================================================
-- Chrono Schema Migration 001: Initial Schema
-- ============================================================================

-- Ensure uuid-ossp or pgcrypto is available for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Categories Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    local_id TEXT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#557FEA',
    subs TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT categories_user_local_id_unique UNIQUE (user_id, local_id)
);

-- Index for ordering categories per user
CREATE INDEX IF NOT EXISTS idx_categories_user_order
    ON public.categories (user_id, sort_order ASC);

-- ----------------------------------------------------------------------------
-- 2. Study Sessions Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    local_id TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration NUMERIC NOT NULL,
    tracking_type TEXT NOT NULL CHECK (tracking_type IN ('stopwatch', 'timer', 'manual')),
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    subcategory TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT sessions_user_local_id_unique UNIQUE (user_id, local_id),
    CONSTRAINT sessions_duration_positive CHECK (duration >= 0),
    CONSTRAINT sessions_time_order CHECK (end_time >= start_time)
);

-- Indexes for querying sessions by user, start date, and category
CREATE INDEX IF NOT EXISTS idx_sessions_user_start
    ON public.sessions (user_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_user_category
    ON public.sessions (user_id, category_id);

-- ----------------------------------------------------------------------------
-- 3. User Preferences Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
    daily_goal_hours NUMERIC NOT NULL DEFAULT 4 CHECK (daily_goal_hours > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 4. Automatic updated_at Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_categories_updated_at ON public.categories;
CREATE TRIGGER set_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_sessions_updated_at ON public.sessions;
CREATE TRIGGER set_sessions_updated_at
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER set_preferences_updated_at
    BEFORE UPDATE ON public.user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
