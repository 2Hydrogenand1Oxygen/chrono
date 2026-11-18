/**
 * Hand-written TypeScript types that mirror the Supabase database schema.
 * Fully compatible with @supabase/supabase-js v2.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      sessions: {
        Row: {
          id: string
          user_id: string
          local_id: string | null
          start_time: string   // timestamptz ISO string
          end_time: string     // timestamptz ISO string
          duration: number     // seconds
          tracking_type: 'stopwatch' | 'timer' | 'manual' | 'focus' | 'break'
          category_id: string | null
          subcategory: string | null
          notes: string | null
          parent_session_id?: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          local_id?: string | null
          start_time: string
          end_time: string
          duration: number
          tracking_type: 'stopwatch' | 'timer' | 'manual' | 'focus' | 'break'
          category_id?: string | null
          subcategory?: string | null
          notes?: string | null
          parent_session_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          local_id?: string | null
          start_time?: string
          end_time?: string
          duration?: number
          tracking_type?: 'stopwatch' | 'timer' | 'manual' | 'focus' | 'break'
          category_id?: string | null
          subcategory?: string | null
          notes?: string | null
          parent_session_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          }
        ]
      }
      categories: {
        Row: {
          id: string
          user_id: string
          local_id: string | null
          name: string
          color: string
          subs: string[]
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          local_id?: string | null
          name: string
          color: string
          subs?: string[]
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          local_id?: string | null
          name?: string
          color?: string
          subs?: string[]
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          user_id: string
          theme: 'light' | 'dark'
          daily_goal_hours: number
          day_start_hour?: number | null
          week_start?: 'monday' | 'sunday' | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          theme?: 'light' | 'dark'
          daily_goal_hours?: number
          day_start_hour?: number | null
          week_start?: 'monday' | 'sunday' | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          theme?: 'light' | 'dark'
          daily_goal_hours?: number
          day_start_hour?: number | null
          week_start?: 'monday' | 'sunday' | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      tracking_type: 'stopwatch' | 'timer' | 'manual' | 'focus' | 'break'
    }
    CompositeTypes: Record<string, never>
  }
}

// ── Convenience aliases ──────────────────────────────────────────────────────
export type DbSession = Database['public']['Tables']['sessions']['Row']
export type DbCategory = Database['public']['Tables']['categories']['Row']
export type DbUserPreferences = Database['public']['Tables']['user_preferences']['Row']
