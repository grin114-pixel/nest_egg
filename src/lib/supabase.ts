import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type TableRow = {
  id: string
  content: string
  amount: number
  checked: boolean
  sort_order: number
}

export type NestEggCard = {
  id: string
  name: string
  rows: TableRow[]
  manual_total: number | null
  /** true = 마이너스 포함(A), false = 미포함(B) */
  include_negatives: boolean
  /**
   * 신규 생성분 A/B 페어 키.
   * null 이면 기존 카드(동기화·마이너스 파트 없음).
   */
  pair_id: string | null
  /** B 페어 카드 전용 마이너스 내역 (A·기존 카드는 빈 배열) */
  minus_rows: TableRow[]
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      nest_egg_app_settings: {
        Row: { id: string; pin_hash: string; updated_at: string }
        Insert: { id?: string; pin_hash: string; updated_at?: string }
        Update: { id?: string; pin_hash?: string; updated_at?: string }
        Relationships: []
      }
      nest_egg_cards: {
        Row: {
          id: string
          name: string
          rows: TableRow[]
          manual_total: number | null
          include_negatives: boolean
          pair_id: string | null
          minus_rows: TableRow[]
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          rows?: TableRow[]
          manual_total?: number | null
          include_negatives?: boolean
          pair_id?: string | null
          minus_rows?: TableRow[]
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          rows?: TableRow[]
          manual_total?: number | null
          include_negatives?: boolean
          pair_id?: string | null
          minus_rows?: TableRow[]
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

let supabaseClient: SupabaseClient<Database> | null = null

function getSupabaseUrl() {
  return String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()
}

function getSupabaseAnonKey() {
  return String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey())
}

export function getSupabaseClient() {
  if (supabaseClient) return supabaseClient

  const url = getSupabaseUrl()
  const key = getSupabaseAnonKey()

  if (!url || !key) {
    throw new Error('Supabase 환경 변수가 설정되지 않았어요.')
  }

  supabaseClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return supabaseClient
}
