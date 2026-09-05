// GENERATED FILE -- do not edit by hand.
// Regenerate with `npm run types:gen` after every migration.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "account_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      arbetsdagbok: {
        Row: {
          covered: unknown
          generated_at: string
          generated_by: string
          id: string
          project_id: string
        }
        Insert: {
          covered: unknown
          generated_at?: string
          generated_by: string
          id?: string
          project_id: string
        }
        Update: {
          covered?: unknown
          generated_at?: string
          generated_by?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arbetsdagbok_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arbetsdagbok_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arbetsdagbok_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arbetsdagbok_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_hours"
            referencedColumns: ["project_id"]
          },
        ]
      }
      clock_edit: {
        Row: {
          edited_at: string
          edited_by: string
          field: string
          id: number
          new_value: string | null
          old_value: string | null
          tilldelning_id: string
        }
        Insert: {
          edited_at?: string
          edited_by: string
          field: string
          id?: never
          new_value?: string | null
          old_value?: string | null
          tilldelning_id: string
        }
        Update: {
          edited_at?: string
          edited_by?: string
          field?: string
          id?: never
          new_value?: string | null
          old_value?: string | null
          tilldelning_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clock_edit_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_edit_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_edit_tilldelning_id_fkey"
            columns: ["tilldelning_id"]
            isOneToOne: false
            referencedRelation: "my_shift"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_edit_tilldelning_id_fkey"
            columns: ["tilldelning_id"]
            isOneToOne: false
            referencedRelation: "tilldelning"
            referencedColumns: ["id"]
          },
        ]
      }
      day_review: {
        Row: {
          acted_at: string
          acted_by: string
          action: Database["public"]["Enums"]["review_action"]
          id: number
          note: string | null
          project_id: string
          work_date: string
        }
        Insert: {
          acted_at?: string
          acted_by: string
          action: Database["public"]["Enums"]["review_action"]
          id?: never
          note?: string | null
          project_id: string
          work_date: string
        }
        Update: {
          acted_at?: string
          acted_by?: string
          action?: Database["public"]["Enums"]["review_action"]
          id?: never
          note?: string | null
          project_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_review_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "day_review_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "day_review_project_id_work_date_fkey"
            columns: ["project_id", "work_date"]
            isOneToOne: false
            referencedRelation: "day_history"
            referencedColumns: ["project_id", "work_date"]
          },
          {
            foreignKeyName: "day_review_project_id_work_date_fkey"
            columns: ["project_id", "work_date"]
            isOneToOne: false
            referencedRelation: "project_day"
            referencedColumns: ["project_id", "work_date"]
          },
        ]
      }
      forval: {
        Row: {
          can_work: boolean
          updated_at: string
          work_date: string
          worker_id: string
        }
        Insert: {
          can_work: boolean
          updated_at?: string
          work_date: string
          worker_id: string
        }
        Update: {
          can_work?: boolean
          updated_at?: string
          work_date?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forval_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "forval_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forval_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_roster"
            referencedColumns: ["id"]
          },
        ]
      }
      notification: {
        Row: {
          account_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload: Json
          read_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload?: Json
          read_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          payload?: Json
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      pass: {
        Row: {
          batch_id: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          end_time: string
          headcount: number
          id: string
          planned_hours: number
          project_id: string
          start_time: string
          work_date: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          end_time: string
          headcount: number
          id?: string
          planned_hours: number
          project_id: string
          start_time: string
          work_date: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          end_time?: string
          headcount?: number
          id?: string
          planned_hours?: number
          project_id?: string
          start_time?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "pass_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "pass_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_hours"
            referencedColumns: ["project_id"]
          },
        ]
      }
      pass_batch: {
        Row: {
          created_at: string
          created_by: string
          id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pass_batch_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_batch_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_batch_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_batch_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_hours"
            referencedColumns: ["project_id"]
          },
        ]
      }
      pass_batch_handpick: {
        Row: {
          batch_id: string
          worker_id: string
        }
        Insert: {
          batch_id: string
          worker_id: string
        }
        Update: {
          batch_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pass_batch_handpick_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "pass_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_batch_handpick_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "pass_batch_handpick_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_batch_handpick_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_roster"
            referencedColumns: ["id"]
          },
        ]
      }
      pass_block: {
        Row: {
          blocked_at: string
          pass_id: string
          worker_id: string
        }
        Insert: {
          blocked_at?: string
          pass_id: string
          worker_id: string
        }
        Update: {
          blocked_at?: string
          pass_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pass_block_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "open_pass"
            referencedColumns: ["pass_id"]
          },
          {
            foreignKeyName: "pass_block_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "pass"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_block_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "pass_block_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_block_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_roster"
            referencedColumns: ["id"]
          },
        ]
      }
      pass_offer: {
        Row: {
          id: string
          offered_at: string
          pass_id: string
          responded_at: string | null
          state: Database["public"]["Enums"]["offer_state"]
          worker_id: string
        }
        Insert: {
          id?: string
          offered_at?: string
          pass_id: string
          responded_at?: string | null
          state?: Database["public"]["Enums"]["offer_state"]
          worker_id: string
        }
        Update: {
          id?: string
          offered_at?: string
          pass_id?: string
          responded_at?: string | null
          state?: Database["public"]["Enums"]["offer_state"]
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pass_offer_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "open_pass"
            referencedColumns: ["pass_id"]
          },
          {
            foreignKeyName: "pass_offer_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "pass"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_offer_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "pass_offer_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_offer_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_roster"
            referencedColumns: ["id"]
          },
        ]
      }
      profile: {
        Row: {
          account_id: string
          adress: string | null
          anhorig_namn: string | null
          anhorig_telefon: string | null
          bankgiro: string | null
          clearingnummer: string | null
          f_skatt: boolean
          fakturaadress: string | null
          foretag_postnummer: string | null
          foretag_stad: string | null
          foretagsnamn: string | null
          har_foretag: boolean
          kontonummer: string | null
          lan: string | null
          momsreg: string | null
          organisationsnummer: string | null
          postnummer: string | null
          stad: string | null
          telefon: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          adress?: string | null
          anhorig_namn?: string | null
          anhorig_telefon?: string | null
          bankgiro?: string | null
          clearingnummer?: string | null
          f_skatt?: boolean
          fakturaadress?: string | null
          foretag_postnummer?: string | null
          foretag_stad?: string | null
          foretagsnamn?: string | null
          har_foretag?: boolean
          kontonummer?: string | null
          lan?: string | null
          momsreg?: string | null
          organisationsnummer?: string | null
          postnummer?: string | null
          stad?: string | null
          telefon?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          adress?: string | null
          anhorig_namn?: string | null
          anhorig_telefon?: string | null
          bankgiro?: string | null
          clearingnummer?: string | null
          f_skatt?: boolean
          fakturaadress?: string | null
          foretag_postnummer?: string | null
          foretag_stad?: string | null
          foretagsnamn?: string | null
          har_foretag?: boolean
          kontonummer?: string | null
          lan?: string | null
          momsreg?: string | null
          organisationsnummer?: string | null
          postnummer?: string | null
          stad?: string | null
          telefon?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      project: {
        Row: {
          bestallare_address: string
          bestallare_bolag: string
          bestallare_orgnr: string
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deleted_at: string | null
          id: string
          name: string
          services: string
          site_address: string
          start_date: string
        }
        Insert: {
          bestallare_address: string
          bestallare_bolag: string
          bestallare_orgnr: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          services: string
          site_address: string
          start_date: string
        }
        Update: {
          bestallare_address?: string
          bestallare_bolag?: string
          bestallare_orgnr?: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          services?: string
          site_address?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      project_day: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_via:
            | Database["public"]["Enums"]["confirmation_source"]
            | null
          created_at: string
          project_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          stage: Database["public"]["Enums"]["day_stage"] | null
          vad_vi_gjorde: string | null
          work_date: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_via?:
            | Database["public"]["Enums"]["confirmation_source"]
            | null
          created_at?: string
          project_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          stage?: Database["public"]["Enums"]["day_stage"] | null
          vad_vi_gjorde?: string | null
          work_date: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_via?:
            | Database["public"]["Enums"]["confirmation_source"]
            | null
          created_at?: string
          project_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          stage?: Database["public"]["Enums"]["day_stage"] | null
          vad_vi_gjorde?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_day_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_day_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_day_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_day_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_hours"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_day_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_day_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_day_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_day_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      project_leader: {
        Row: {
          account_id: string
          assigned_at: string
          project_id: string
        }
        Insert: {
          account_id: string
          assigned_at?: string
          project_id: string
        }
        Update: {
          account_id?: string
          assigned_at?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_leader_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_leader_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_leader_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_leader_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_hours"
            referencedColumns: ["project_id"]
          },
        ]
      }
      tilldelning: {
        Row: {
          clock_in: string | null
          clock_in_original: string | null
          clock_out: string | null
          clock_out_original: string | null
          confirmed_hours: number | null
          created_at: string
          id: string
          late: boolean
          pass_id: string
          released_at: string | null
          released_by: string | null
          released_reason: Database["public"]["Enums"]["release_reason"] | null
          source: Database["public"]["Enums"]["assignment_source"]
          work_date: string
          worker_id: string
        }
        Insert: {
          clock_in?: string | null
          clock_in_original?: string | null
          clock_out?: string | null
          clock_out_original?: string | null
          confirmed_hours?: number | null
          created_at?: string
          id?: string
          late?: boolean
          pass_id: string
          released_at?: string | null
          released_by?: string | null
          released_reason?: Database["public"]["Enums"]["release_reason"] | null
          source: Database["public"]["Enums"]["assignment_source"]
          work_date: string
          worker_id: string
        }
        Update: {
          clock_in?: string | null
          clock_in_original?: string | null
          clock_out?: string | null
          clock_out_original?: string | null
          confirmed_hours?: number | null
          created_at?: string
          id?: string
          late?: boolean
          pass_id?: string
          released_at?: string | null
          released_by?: string | null
          released_reason?: Database["public"]["Enums"]["release_reason"] | null
          source?: Database["public"]["Enums"]["assignment_source"]
          work_date?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tilldelning_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "open_pass"
            referencedColumns: ["pass_id"]
          },
          {
            foreignKeyName: "tilldelning_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "pass"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tilldelning_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tilldelning_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tilldelning_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "account_directory"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "tilldelning_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tilldelning_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_roster"
            referencedColumns: ["id"]
          },
        ]
      }
      worker: {
        Row: {
          account_id: string
          avatar_url: string | null
          bank_number: string | null
          clearing_number: string | null
          created_at: string
          deleted_at: string | null
          email: string
          id: string
          late_marks: number
          name: string
          personnummer: string | null
          phone: string | null
        }
        Insert: {
          account_id: string
          avatar_url?: string | null
          bank_number?: string | null
          clearing_number?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          id?: string
          late_marks?: number
          name: string
          personnummer?: string | null
          phone?: string | null
        }
        Update: {
          account_id?: string
          avatar_url?: string | null
          bank_number?: string | null
          clearing_number?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          id?: string
          late_marks?: number
          name?: string
          personnummer?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "account_directory"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      account_directory: {
        Row: {
          active: boolean | null
          email: string | null
          id: string | null
          name: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          worker_id: string | null
        }
        Relationships: []
      }
      day_history: {
        Row: {
          confirmed_at: string | null
          confirmed_by_name: string | null
          confirmed_via:
            | Database["public"]["Enums"]["confirmation_source"]
            | null
          filed: boolean | null
          project_id: string | null
          project_name: string | null
          rejected_at: string | null
          rejection_note: string | null
          reviewed_at: string | null
          reviewed_by_name: string | null
          stage: Database["public"]["Enums"]["day_stage"] | null
          vad_vi_gjorde: string | null
          work_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_day_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_day_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_hours"
            referencedColumns: ["project_id"]
          },
        ]
      }
      my_offer: {
        Row: {
          end_time: string | null
          pass_id: string | null
          planned_hours: number | null
          project_name: string | null
          site_address: string | null
          start_time: string | null
          work_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pass_offer_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "open_pass"
            referencedColumns: ["pass_id"]
          },
          {
            foreignKeyName: "pass_offer_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "pass"
            referencedColumns: ["id"]
          },
        ]
      }
      my_shift: {
        Row: {
          clock_in: string | null
          clock_out: string | null
          confirmed_hours: number | null
          day_confirmed: boolean | null
          end_time: string | null
          filed: boolean | null
          id: string | null
          pass_id: string | null
          planned_hours: number | null
          project_id: string | null
          project_name: string | null
          site_address: string | null
          start_time: string | null
          work_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pass_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pass_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_hours"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "tilldelning_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "open_pass"
            referencedColumns: ["pass_id"]
          },
          {
            foreignKeyName: "tilldelning_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "pass"
            referencedColumns: ["id"]
          },
        ]
      }
      open_pass: {
        Row: {
          end_time: string | null
          headcount: number | null
          pass_id: string | null
          planned_hours: number | null
          project_name: string | null
          site_address: string | null
          slots_open: number | null
          start_time: string | null
          work_date: string | null
        }
        Relationships: []
      }
      project_hours: {
        Row: {
          hours: number | null
          name: string | null
          project_id: string | null
          site_address: string | null
          start_date: string | null
        }
        Relationships: []
      }
      worker_roster: {
        Row: {
          id: string | null
          late_marks: number | null
          name: string | null
        }
        Insert: {
          id?: string | null
          late_marks?: number | null
          name?: string | null
        }
        Update: {
          id?: string | null
          late_marks?: number | null
          name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_offer: { Args: { p_pass: string }; Returns: string }
      approve_day: {
        Args: {
          p_project: string
          p_rows?: Json
          p_text?: string
          p_work_date: string
        }
        Returns: undefined
      }
      assign_snabb: {
        Args: { p_pass: string; p_worker: string }
        Returns: string
      }
      batch_shortfall: {
        Args: { p_dates: string[]; p_slots_per_day: number }
        Returns: {
          available: number
          short: number
          slots: number
          work_date: string
        }[]
      }
      bristsurvey_gaps: {
        Args: { p_from: string; p_project: string; p_to: string }
        Returns: Json
      }
      clock_in: { Args: { p_tilldelning: string }; Returns: string }
      clock_out: { Args: { p_tilldelning: string }; Returns: string }
      complete_bristsurvey: {
        Args: { p_project: string; p_text: string; p_work_date: string }
        Returns: undefined
      }
      create_snabb_pass: {
        Args: {
          p_date: string
          p_end: string
          p_hours: number
          p_project: string
          p_start: string
          p_worker: string
        }
        Returns: string
      }
      decline_offer: { Args: { p_pass: string }; Returns: undefined }
      delete_pass: { Args: { p_pass: string }; Returns: undefined }
      fill_passes: {
        Args: { p_batch: string }
        Returns: {
          filled: number
          filled_pass: string
          for_date: string
          offered: number
          slots: number
        }[]
      }
      forval_coverage: {
        Args: { p_dates: string[] }
        Returns: {
          available: number
          work_date: string
        }[]
      }
      reject_day: {
        Args: { p_note: string; p_project: string; p_work_date: string }
        Returns: undefined
      }
      release_assignment: {
        Args: {
          p_reason?: Database["public"]["Enums"]["release_reason"]
          p_tilldelning: string
        }
        Returns: {
          filled: number
          offered: number
          reopened: boolean
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "arbetsledare" | "arbetare"
      assignment_source:
        | "handplockad"
        | "forval"
        | "oppen"
        | "manuell"
        | "snabb"
      confirmation_source: "leader" | "bristsurvey"
      day_stage: "leader_confirmed" | "admin_confirmed"
      notification_kind: "shift_deleted" | "shift_offered" | "day_unconfirmed"
      offer_state: "offered" | "accepted" | "declined" | "withdrawn"
      release_reason:
        | "removed_by_leader"
        | "replaced_by_snabb"
        | "shift_deleted"
        | "absent_at_confirmation"
        | "account_paused"
      review_action: "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "arbetsledare", "arbetare"],
      assignment_source: ["handplockad", "forval", "oppen", "manuell", "snabb"],
      confirmation_source: ["leader", "bristsurvey"],
      day_stage: ["leader_confirmed", "admin_confirmed"],
      notification_kind: ["shift_deleted", "shift_offered", "day_unconfirmed"],
      offer_state: ["offered", "accepted", "declined", "withdrawn"],
      release_reason: [
        "removed_by_leader",
        "replaced_by_snabb",
        "shift_deleted",
        "absent_at_confirmation",
        "account_paused",
      ],
      review_action: ["approved", "rejected"],
    },
  },
} as const
