-- Migration 005: Focus Sessions Support
-- Expands tracking_type to support 'focus' and 'break'
-- Adds optional parent_session_id to group focus and break intervals belonging to the same focus session

ALTER TABLE public.sessions
    DROP CONSTRAINT IF EXISTS sessions_tracking_type_check;

ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_tracking_type_check
    CHECK (tracking_type IN ('stopwatch', 'timer', 'manual', 'focus', 'break'));

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS parent_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_parent_session_id
    ON public.sessions (parent_session_id)
    WHERE parent_session_id IS NOT NULL;
