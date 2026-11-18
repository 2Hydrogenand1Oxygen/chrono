-- Migration 004: Custom Day Reset Time & Week Start Preferences
-- Adds day_start_hour (0..6) and week_start ('monday'|'sunday') to user_preferences

ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS day_start_hour SMALLINT DEFAULT 0 CHECK (day_start_hour BETWEEN 0 AND 6),
    ADD COLUMN IF NOT EXISTS week_start TEXT DEFAULT 'monday' CHECK (week_start IN ('monday', 'sunday'));
