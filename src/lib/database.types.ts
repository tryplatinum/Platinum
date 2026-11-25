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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity: {
        Row: {
          actor: string
          actor_user: string | null
          at: string
          created_at: string
          firm_id: string
          id: string
          seq: number
          student_id: string
          text: string
          updated_at: string
        }
        Insert: {
          actor: string
          actor_user?: string | null
          at?: string
          created_at?: string
          firm_id: string
          id?: string
          seq?: number
          student_id: string
          text: string
          updated_at?: string
        }
        Update: {
          actor?: string
          actor_user?: string | null
          at?: string
          created_at?: string
          firm_id?: string
          id?: string
          seq?: number
          student_id?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          content: Json
          created_at: string
          firm_id: string
          id: string
          input_tokens: number | null
          output_tokens: number | null
          role: string
          thread_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          firm_id: string
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          role: string
          thread_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          firm_id?: string
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_proposals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          firm_id: string
          id: string
          kind: string
          payload: Json
          rationale: string
          sources: Json
          status: string
          student_id: string
          thread_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          firm_id: string
          id?: string
          kind: string
          payload: Json
          rationale?: string
          sources?: Json
          status?: string
          student_id: string
          thread_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          firm_id?: string
          id?: string
          kind?: string
          payload?: Json
          rationale?: string
          sources?: Json
          status?: string
          student_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_proposals_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_proposals_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
          {
            foreignKeyName: "agent_proposals_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_threads: {
        Row: {
          counselor_id: string
          created_at: string
          firm_id: string
          id: string
          student_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          counselor_id: string
          created_at?: string
          firm_id: string
          id?: string
          student_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          counselor_id?: string
          created_at?: string
          firm_id?: string
          id?: string
          student_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_threads_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_threads_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      agent_usage: {
        Row: {
          calls: number
          day: string
          firm_id: string
        }
        Insert: {
          calls?: number
          day: string
          firm_id: string
        }
        Update: {
          calls?: number
          day?: string
          firm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_usage_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      college_directory: {
        Row: {
          act_25: number | null
          act_50: number | null
          act_75: number | null
          admit_rate: number | null
          aliases: string[]
          avg_net_price: number | null
          city: string | null
          completion_rate: number | null
          control: string | null
          imported_at: string
          is_active: boolean
          lat: number | null
          level: string | null
          locale: string | null
          lon: number | null
          median_earnings: number | null
          name: string
          open_admissions: boolean | null
          pct_submitting_act: number | null
          pct_submitting_sat: number | null
          region: string | null
          sat_ebrw_25: number | null
          sat_ebrw_50: number | null
          sat_ebrw_75: number | null
          sat_math_25: number | null
          sat_math_50: number | null
          sat_math_75: number | null
          search_text: string
          sources: Json
          state: string | null
          test_policy: string | null
          test_policy_code: number | null
          tuition_in_state: number | null
          tuition_out_of_state: number | null
          undergrad_size: number | null
          unitid: number
          url: string | null
        }
        Insert: {
          act_25?: number | null
          act_50?: number | null
          act_75?: number | null
          admit_rate?: number | null
          aliases?: string[]
          avg_net_price?: number | null
          city?: string | null
          completion_rate?: number | null
          control?: string | null
          imported_at?: string
          is_active?: boolean
          lat?: number | null
          level?: string | null
          locale?: string | null
          lon?: number | null
          median_earnings?: number | null
          name: string
          open_admissions?: boolean | null
          pct_submitting_act?: number | null
          pct_submitting_sat?: number | null
          region?: string | null
          sat_ebrw_25?: number | null
          sat_ebrw_50?: number | null
          sat_ebrw_75?: number | null
          sat_math_25?: number | null
          sat_math_50?: number | null
          sat_math_75?: number | null
          search_text?: string
          sources?: Json
          state?: string | null
          test_policy?: string | null
          test_policy_code?: number | null
          tuition_in_state?: number | null
          tuition_out_of_state?: number | null
          undergrad_size?: number | null
          unitid: number
          url?: string | null
        }
        Update: {
          act_25?: number | null
          act_50?: number | null
          act_75?: number | null
          admit_rate?: number | null
          aliases?: string[]
          avg_net_price?: number | null
          city?: string | null
          completion_rate?: number | null
          control?: string | null
          imported_at?: string
          is_active?: boolean
          lat?: number | null
          level?: string | null
          locale?: string | null
          lon?: number | null
          median_earnings?: number | null
          name?: string
          open_admissions?: boolean | null
          pct_submitting_act?: number | null
          pct_submitting_sat?: number | null
          region?: string | null
          sat_ebrw_25?: number | null
          sat_ebrw_50?: number | null
          sat_ebrw_75?: number | null
          sat_math_25?: number | null
          sat_math_50?: number | null
          sat_math_75?: number | null
          search_text?: string
          sources?: Json
          state?: string | null
          test_policy?: string | null
          test_policy_code?: number | null
          tuition_in_state?: number | null
          tuition_out_of_state?: number | null
          undergrad_size?: number | null
          unitid?: number
          url?: string | null
        }
        Relationships: []
      }
      college_list_draft_items: {
        Row: {
          ai_explained: boolean
          created_at: string
          draft_id: string
          firm_id: string
          fit: string
          fit_basis: Json
          fit_set_by: string
          id: string
          kept: boolean
          position: number
          reason: string
          unitid: number
          updated_at: string
        }
        Insert: {
          ai_explained?: boolean
          created_at?: string
          draft_id: string
          firm_id: string
          fit: string
          fit_basis?: Json
          fit_set_by?: string
          id?: string
          kept?: boolean
          position?: number
          reason?: string
          unitid: number
          updated_at?: string
        }
        Update: {
          ai_explained?: boolean
          created_at?: string
          draft_id?: string
          firm_id?: string
          fit?: string
          fit_basis?: Json
          fit_set_by?: string
          id?: string
          kept?: boolean
          position?: number
          reason?: string
          unitid?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "college_list_draft_items_firm_id_draft_id_fkey"
            columns: ["firm_id", "draft_id"]
            isOneToOne: false
            referencedRelation: "college_list_drafts"
            referencedColumns: ["firm_id", "id"]
          },
          {
            foreignKeyName: "college_list_draft_items_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "college_list_draft_items_unitid_fkey"
            columns: ["unitid"]
            isOneToOne: false
            referencedRelation: "college_directory"
            referencedColumns: ["unitid"]
          },
        ]
      }
      college_list_drafts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          created_at: string
          created_by: string | null
          firm_id: string
          id: string
          note: string | null
          preferences: Json
          seq: number
          source: Json | null
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          created_at?: string
          created_by?: string | null
          firm_id: string
          id?: string
          note?: string | null
          preferences?: Json
          seq?: number
          source?: Json | null
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          created_at?: string
          created_by?: string | null
          firm_id?: string
          id?: string
          note?: string | null
          preferences?: Json
          seq?: number
          source?: Json | null
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "college_list_drafts_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "college_list_drafts_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      college_programs: {
        Row: {
          cip_code: string
          cip_title: string
          credential_level: number
          unitid: number
        }
        Insert: {
          cip_code: string
          cip_title: string
          credential_level?: number
          unitid: number
        }
        Update: {
          cip_code?: string
          cip_title?: string
          credential_level?: number
          unitid?: number
        }
        Relationships: [
          {
            foreignKeyName: "college_programs_unitid_fkey"
            columns: ["unitid"]
            isOneToOne: false
            referencedRelation: "college_directory"
            referencedColumns: ["unitid"]
          },
        ]
      }
      colleges: {
        Row: {
          created_at: string
          deadline: string | null
          directory_unitid: number | null
          firm_id: string
          fit: string
          fit_reason: string | null
          fit_set_by: string | null
          id: string
          name: string
          note: string | null
          plan: string | null
          seq: number
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          directory_unitid?: number | null
          firm_id: string
          fit: string
          fit_reason?: string | null
          fit_set_by?: string | null
          id?: string
          name: string
          note?: string | null
          plan?: string | null
          seq?: number
          status: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          directory_unitid?: number | null
          firm_id?: string
          fit?: string
          fit_reason?: string | null
          fit_set_by?: string | null
          id?: string
          name?: string
          note?: string | null
          plan?: string | null
          seq?: number
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "colleges_directory_unitid_fkey"
            columns: ["directory_unitid"]
            isOneToOne: false
            referencedRelation: "college_directory"
            referencedColumns: ["unitid"]
          },
          {
            foreignKeyName: "colleges_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colleges_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      document_events: {
        Row: {
          action: string
          actor_kind: string
          actor_user: string | null
          created_at: string
          detail: Json
          document_id: string
          firm_id: string
          id: string
        }
        Insert: {
          action: string
          actor_kind: string
          actor_user?: string | null
          created_at?: string
          detail?: Json
          document_id: string
          firm_id: string
          id?: string
        }
        Update: {
          action?: string
          actor_kind?: string
          actor_user?: string | null
          created_at?: string
          detail?: Json
          document_id?: string
          firm_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_events_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      document_types: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string
          firm_id: string
          id: string
          name: string
          position: number
          sensitivity: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string
          firm_id: string
          id?: string
          name: string
          position?: number
          sensitivity?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string
          firm_id?: string
          id?: string
          name?: string
          position?: number
          sensitivity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_types_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          added_by: string
          added_on: string
          ai_suggestion: Json | null
          category: string
          college_id: string | null
          content_hash: string | null
          created_at: string
          drafts: Json | null
          drive_file_id: string | null
          drive_modified_at: string | null
          drive_url: string | null
          essay_group: string | null
          essay_prompt: string | null
          feedback: Json | null
          file_status: string | null
          firm_id: string
          id: string
          kind: string
          mime_type: string | null
          name: string
          needs_check: boolean
          note: string | null
          opened_at: string | null
          original_filename: string | null
          school_year: string | null
          seq: number
          size_bytes: number | null
          sorted_by: string | null
          source: string | null
          status: string | null
          storage_path: string | null
          student_id: string | null
          student_link_id: string | null
          target: string | null
          task_id: string | null
          title: string | null
          topic: string | null
          type_id: string | null
          updated_at: string
          uploaded_by_kind: string | null
          uploaded_by_user: string | null
          url: string | null
          word_limit: number | null
        }
        Insert: {
          added_by: string
          added_on?: string
          ai_suggestion?: Json | null
          category: string
          college_id?: string | null
          content_hash?: string | null
          created_at?: string
          drafts?: Json | null
          drive_file_id?: string | null
          drive_modified_at?: string | null
          drive_url?: string | null
          essay_group?: string | null
          essay_prompt?: string | null
          feedback?: Json | null
          file_status?: string | null
          firm_id: string
          id?: string
          kind: string
          mime_type?: string | null
          name: string
          needs_check?: boolean
          note?: string | null
          opened_at?: string | null
          original_filename?: string | null
          school_year?: string | null
          seq?: number
          size_bytes?: number | null
          sorted_by?: string | null
          source?: string | null
          status?: string | null
          storage_path?: string | null
          student_id?: string | null
          student_link_id?: string | null
          target?: string | null
          task_id?: string | null
          title?: string | null
          topic?: string | null
          type_id?: string | null
          updated_at?: string
          uploaded_by_kind?: string | null
          uploaded_by_user?: string | null
          url?: string | null
          word_limit?: number | null
        }
        Update: {
          added_by?: string
          added_on?: string
          ai_suggestion?: Json | null
          category?: string
          college_id?: string | null
          content_hash?: string | null
          created_at?: string
          drafts?: Json | null
          drive_file_id?: string | null
          drive_modified_at?: string | null
          drive_url?: string | null
          essay_group?: string | null
          essay_prompt?: string | null
          feedback?: Json | null
          file_status?: string | null
          firm_id?: string
          id?: string
          kind?: string
          mime_type?: string | null
          name?: string
          needs_check?: boolean
          note?: string | null
          opened_at?: string | null
          original_filename?: string | null
          school_year?: string | null
          seq?: number
          size_bytes?: number | null
          sorted_by?: string | null
          source?: string | null
          status?: string | null
          storage_path?: string | null
          student_id?: string | null
          student_link_id?: string | null
          target?: string | null
          task_id?: string | null
          title?: string | null
          topic?: string | null
          type_id?: string | null
          updated_at?: string
          uploaded_by_kind?: string | null
          uploaded_by_user?: string | null
          url?: string | null
          word_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
          {
            foreignKeyName: "documents_student_link_id_fkey"
            columns: ["student_link_id"]
            isOneToOne: false
            referencedRelation: "student_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_type_fkey"
            columns: ["firm_id", "type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      firm_members: {
        Row: {
          created_at: string
          display_name: string
          firm_id: string
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          firm_id: string
          id?: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          firm_id?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_members_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_files_automatically: boolean
          updated_at: string
          weekly_text_day: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_files_automatically?: boolean
          updated_at?: string
          weekly_text_day?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_files_automatically?: boolean
          updated_at?: string
          weekly_text_day?: number
        }
        Relationships: []
      }
      google_connections: {
        Row: {
          connected_at: string
          firm_id: string
          google_address: string
          last_error: string | null
          refresh_token_encrypted: string
          scopes: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          firm_id: string
          google_address: string
          last_error?: string | null
          refresh_token_encrypted: string
          scopes?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string
          firm_id?: string
          google_address?: string
          last_error?: string | null
          refresh_token_encrypted?: string
          scopes?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_connections_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          agenda: Json | null
          ai: Json | null
          brief: Json | null
          created_at: string
          date: string
          duration_min: number
          firm_id: string
          id: string
          location: string | null
          recap: Json | null
          seq: number
          status: string
          student_id: string
          time: string
          title: string
          transcript: string | null
          updated_at: string
        }
        Insert: {
          agenda?: Json | null
          ai?: Json | null
          brief?: Json | null
          created_at?: string
          date: string
          duration_min?: number
          firm_id: string
          id?: string
          location?: string | null
          recap?: Json | null
          seq?: number
          status: string
          student_id: string
          time: string
          title: string
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          agenda?: Json | null
          ai?: Json | null
          brief?: Json | null
          created_at?: string
          date?: string
          duration_min?: number
          firm_id?: string
          id?: string
          location?: string | null
          recap?: Json | null
          seq?: number
          status?: string
          student_id?: string
          time?: string
          title?: string
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      outbox: {
        Row: {
          approval: Json | null
          approved_at: string | null
          approved_by: string | null
          body: string
          body_en: string | null
          channel: string
          created_at: string
          dedupe_key: string | null
          delivery_detail: string | null
          error: string | null
          firm_id: string
          id: string
          kind: string
          language: string
          note: string | null
          parent_id: string | null
          provider_message_id: string | null
          send_after: string
          sent_at: string
          seq: number
          status: string
          student_id: string
          task_id: string | null
          to_kind: string
          to_name: string
          trigger: string
          updated_at: string
        }
        Insert: {
          approval?: Json | null
          approved_at?: string | null
          approved_by?: string | null
          body: string
          body_en?: string | null
          channel: string
          created_at?: string
          dedupe_key?: string | null
          delivery_detail?: string | null
          error?: string | null
          firm_id: string
          id?: string
          kind: string
          language: string
          note?: string | null
          parent_id?: string | null
          provider_message_id?: string | null
          send_after: string
          sent_at?: string
          seq?: number
          status?: string
          student_id: string
          task_id?: string | null
          to_kind: string
          to_name: string
          trigger: string
          updated_at?: string
        }
        Update: {
          approval?: Json | null
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          body_en?: string | null
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          delivery_detail?: string | null
          error?: string | null
          firm_id?: string
          id?: string
          kind?: string
          language?: string
          note?: string | null
          parent_id?: string | null
          provider_message_id?: string | null
          send_after?: string
          sent_at?: string
          seq?: number
          status?: string
          student_id?: string
          task_id?: string | null
          to_kind?: string
          to_name?: string
          trigger?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      parents: {
        Row: {
          channel: string
          created_at: string
          email: string | null
          firm_id: string
          id: string
          is_primary: boolean
          language: string
          line_id: string | null
          local_name: string | null
          name: string
          note: string | null
          phone: string | null
          relationship: string
          seq: number
          student_id: string
          updated_at: string
          wechat_id: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          email?: string | null
          firm_id: string
          id?: string
          is_primary?: boolean
          language: string
          line_id?: string | null
          local_name?: string | null
          name: string
          note?: string | null
          phone?: string | null
          relationship: string
          seq?: number
          student_id: string
          updated_at?: string
          wechat_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          email?: string | null
          firm_id?: string
          id?: string
          is_primary?: boolean
          language?: string
          line_id?: string | null
          local_name?: string | null
          name?: string
          note?: string | null
          phone?: string | null
          relationship?: string
          seq?: number
          student_id?: string
          updated_at?: string
          wechat_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parents_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parents_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      personal_notes: {
        Row: {
          approval: Json
          created_at: string
          event_date: string | null
          event_date_approx: boolean
          firm_id: string
          id: string
          meeting_id: string | null
          seq: number
          source: string
          student_id: string
          text: string
          updated_at: string
          uses: Json
        }
        Insert: {
          approval: Json
          created_at?: string
          event_date?: string | null
          event_date_approx?: boolean
          firm_id: string
          id?: string
          meeting_id?: string | null
          seq?: number
          source: string
          student_id: string
          text: string
          updated_at?: string
          uses?: Json
        }
        Update: {
          approval?: Json
          created_at?: string
          event_date?: string | null
          event_date_approx?: boolean
          firm_id?: string
          id?: string
          meeting_id?: string | null
          seq?: number
          source?: string
          student_id?: string
          text?: string
          updated_at?: string
          uses?: Json
        }
        Relationships: [
          {
            foreignKeyName: "personal_notes_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_notes_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
          {
            foreignKeyName: "personal_notes_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_devices: {
        Row: {
          counselor_id: string
          created_at: string
          firm_id: string
          first_seen_at: string | null
          id: string
          key_expires_at: string
          key_hash: string
          label: string
          last_seen_at: string | null
          last_wake_at: string | null
          notice_shown_at: string | null
          own_phone: string | null
          platform: string
          revoked_at: string | null
          wake_email: string
        }
        Insert: {
          counselor_id: string
          created_at?: string
          firm_id: string
          first_seen_at?: string | null
          id?: string
          key_expires_at: string
          key_hash: string
          label: string
          last_seen_at?: string | null
          last_wake_at?: string | null
          notice_shown_at?: string | null
          own_phone?: string | null
          platform?: string
          revoked_at?: string | null
          wake_email: string
        }
        Update: {
          counselor_id?: string
          created_at?: string
          firm_id?: string
          first_seen_at?: string | null
          id?: string
          key_expires_at?: string
          key_hash?: string
          label?: string
          last_seen_at?: string | null
          last_wake_at?: string | null
          notice_shown_at?: string | null
          own_phone?: string | null
          platform?: string
          revoked_at?: string | null
          wake_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_devices_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_job_events: {
        Row: {
          actor: string
          actor_id: string | null
          at: string
          from_status: string | null
          id: string
          job_id: string
          late: boolean
          to_status: string
        }
        Insert: {
          actor: string
          actor_id?: string | null
          at?: string
          from_status?: string | null
          id?: string
          job_id: string
          late?: boolean
          to_status: string
        }
        Update: {
          actor?: string
          actor_id?: string | null
          at?: string
          from_status?: string | null
          id?: string
          job_id?: string
          late?: boolean
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "phone_send_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_send_jobs: {
        Row: {
          body: string | null
          claim_id: string | null
          claimed_at: string | null
          created_at: string
          device_id: string
          error: string | null
          expires_at: string
          id: string
          lease_expires_at: string | null
          outbox_id: string | null
          reported_at: string | null
          status: string
          to_phone: string
        }
        Insert: {
          body?: string | null
          claim_id?: string | null
          claimed_at?: string | null
          created_at?: string
          device_id: string
          error?: string | null
          expires_at?: string
          id?: string
          lease_expires_at?: string | null
          outbox_id?: string | null
          reported_at?: string | null
          status?: string
          to_phone: string
        }
        Update: {
          body?: string | null
          claim_id?: string | null
          claimed_at?: string | null
          created_at?: string
          device_id?: string
          error?: string | null
          expires_at?: string
          id?: string
          lease_expires_at?: string | null
          outbox_id?: string | null
          reported_at?: string | null
          status?: string
          to_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_send_jobs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "phone_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_send_jobs_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_setup_codes: {
        Row: {
          code_hash: string
          counselor_id: string
          created_at: string
          expires_at: string
          firm_id: string
          id: string
          label: string
          notice_shown: boolean
          used_at: string | null
        }
        Insert: {
          code_hash: string
          counselor_id: string
          created_at?: string
          expires_at: string
          firm_id: string
          id?: string
          label: string
          notice_shown?: boolean
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          counselor_id?: string
          created_at?: string
          expires_at?: string
          firm_id?: string
          id?: string
          label?: string
          notice_shown?: boolean
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_setup_codes_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_rules: {
        Row: {
          created_at: string
          days: number
          firm_id: string
          id: string
          mode: string
          rule: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          days: number
          firm_id: string
          id?: string
          mode: string
          rule: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          days?: number
          firm_id?: string
          id?: string
          mode?: string
          rule?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_rules_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_skips: {
        Row: {
          dedupe_key: string
          firm_id: string
          id: string
          skipped_at: string
          skipped_by: string | null
          until: string | null
        }
        Insert: {
          dedupe_key: string
          firm_id: string
          id?: string
          skipped_at?: string
          skipped_by?: string | null
          until?: string | null
        }
        Update: {
          dedupe_key?: string
          firm_id?: string
          id?: string
          skipped_at?: string
          skipped_by?: string | null
          until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_skips_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          approval: Json | null
          body_en: string
          body_local: string | null
          channel: string
          created_at: string
          created_on: string
          facts: Json | null
          firm_id: string
          id: string
          language: string
          meeting_id: string | null
          parent_id: string
          sent_on: string | null
          seq: number
          source: Json | null
          status: string
          student_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          approval?: Json | null
          body_en: string
          body_local?: string | null
          channel: string
          created_at?: string
          created_on?: string
          facts?: Json | null
          firm_id: string
          id?: string
          language: string
          meeting_id?: string | null
          parent_id: string
          sent_on?: string | null
          seq?: number
          source?: Json | null
          status: string
          student_id: string
          subject: string
          updated_at?: string
        }
        Update: {
          approval?: Json | null
          body_en?: string
          body_local?: string | null
          channel?: string
          created_at?: string
          created_on?: string
          facts?: Json | null
          firm_id?: string
          id?: string
          language?: string
          meeting_id?: string | null
          parent_id?: string
          sent_on?: string | null
          seq?: number
          source?: Json | null
          status?: string
          student_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
          {
            foreignKeyName: "reports_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      student_drive_folders: {
        Row: {
          created_at: string
          drive_folder_id: string
          drive_url: string | null
          firm_id: string
          folder_name: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          lease_until: string | null
          linked_by: string | null
          missing_file_ids: string[]
          progress_done: number
          progress_total: number
          removed_here_count: number
          skipped: Json
          status: string
          student_id: string
          sync_state: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          drive_folder_id: string
          drive_url?: string | null
          firm_id: string
          folder_name: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          lease_until?: string | null
          linked_by?: string | null
          missing_file_ids?: string[]
          progress_done?: number
          progress_total?: number
          removed_here_count?: number
          skipped?: Json
          status?: string
          student_id: string
          sync_state?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          drive_folder_id?: string
          drive_url?: string | null
          firm_id?: string
          folder_name?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          lease_until?: string | null
          linked_by?: string | null
          missing_file_ids?: string[]
          progress_done?: number
          progress_total?: number
          removed_here_count?: number
          skipped?: Json
          status?: string
          student_id?: string
          sync_state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_drive_folders_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_drive_folders_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          firm_id: string
          id: string
          revoked_at: string | null
          student_id: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          firm_id: string
          id?: string
          revoked_at?: string | null
          student_id: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          firm_id?: string
          id?: string
          revoked_at?: string | null
          student_id?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_links_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_links_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
      students: {
        Row: {
          activities: Json
          archived: boolean
          city: string
          counselor_notes: string
          created_at: string
          email: string | null
          firm_id: string
          first_name: string
          gpa: number | null
          gpa_weighted: number | null
          grad_year: number
          id: string
          interests: Json
          last_name: string
          local_name: string | null
          majors: Json
          onboarded_on: string
          parent_copy: string
          phone: string | null
          preferred_channel: string | null
          report_settings: Json
          school: string
          seq: number
          tests: Json
          updated_at: string
          weekly_text: boolean
        }
        Insert: {
          activities?: Json
          archived?: boolean
          city?: string
          counselor_notes?: string
          created_at?: string
          email?: string | null
          firm_id: string
          first_name: string
          gpa?: number | null
          gpa_weighted?: number | null
          grad_year: number
          id?: string
          interests?: Json
          last_name: string
          local_name?: string | null
          majors?: Json
          onboarded_on?: string
          parent_copy?: string
          phone?: string | null
          preferred_channel?: string | null
          report_settings?: Json
          school?: string
          seq?: number
          tests?: Json
          updated_at?: string
          weekly_text?: boolean
        }
        Update: {
          activities?: Json
          archived?: boolean
          city?: string
          counselor_notes?: string
          created_at?: string
          email?: string | null
          firm_id?: string
          first_name?: string
          gpa?: number | null
          gpa_weighted?: number | null
          grad_year?: number
          id?: string
          interests?: Json
          last_name?: string
          local_name?: string | null
          majors?: Json
          onboarded_on?: string
          parent_copy?: string
          phone?: string | null
          preferred_channel?: string | null
          report_settings?: Json
          school?: string
          seq?: number
          tests?: Json
          updated_at?: string
          weekly_text?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "students_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          approval: Json | null
          attachments: Json
          category: string
          completed_by: string | null
          completed_on: string | null
          created_at: string
          created_on: string
          detail: string | null
          due_date: string
          expects_document: string | null
          firm_id: string
          id: string
          meeting_id: string | null
          owner: string
          owner_parent_id: string | null
          progress_note: string | null
          seq: number
          source: string
          status: string
          student_id: string
          title: string
          updated_at: string
        }
        Insert: {
          approval?: Json | null
          attachments?: Json
          category: string
          completed_by?: string | null
          completed_on?: string | null
          created_at?: string
          created_on?: string
          detail?: string | null
          due_date: string
          expects_document?: string | null
          firm_id: string
          id?: string
          meeting_id?: string | null
          owner: string
          owner_parent_id?: string | null
          progress_note?: string | null
          seq?: number
          source: string
          status: string
          student_id: string
          title: string
          updated_at?: string
        }
        Update: {
          approval?: Json | null
          attachments?: Json
          category?: string
          completed_by?: string | null
          completed_on?: string | null
          created_at?: string
          created_on?: string
          detail?: string | null
          due_date?: string
          expects_document?: string | null
          firm_id?: string
          id?: string
          meeting_id?: string | null
          owner?: string
          owner_parent_id?: string | null
          progress_note?: string | null
          seq?: number
          source?: string
          status?: string
          student_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
          {
            foreignKeyName: "tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owner_parent_id_fkey"
            columns: ["owner_parent_id"]
            isOneToOne: false
            referencedRelation: "parents"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_texts: {
        Row: {
          approval: Json | null
          body: string
          created_at: string
          facts: Json | null
          firm_id: string
          id: string
          lead: Json | null
          parent_copy: Json | null
          sent_via: string | null
          seq: number
          source: Json | null
          status: string
          student_id: string
          updated_at: string
          used_note: Json | null
          week_start: string
        }
        Insert: {
          approval?: Json | null
          body?: string
          created_at?: string
          facts?: Json | null
          firm_id: string
          id?: string
          lead?: Json | null
          parent_copy?: Json | null
          sent_via?: string | null
          seq?: number
          source?: Json | null
          status: string
          student_id: string
          updated_at?: string
          used_note?: Json | null
          week_start: string
        }
        Update: {
          approval?: Json | null
          body?: string
          created_at?: string
          facts?: Json | null
          firm_id?: string
          id?: string
          lead?: Json | null
          parent_copy?: Json | null
          sent_via?: string | null
          seq?: number
          source?: Json | null
          status?: string
          student_id?: string
          updated_at?: string
          used_note?: Json | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_texts_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_texts_firm_id_student_id_fkey"
            columns: ["firm_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["firm_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_draft_to_college_list: { Args: { draft: string }; Returns: number }
      apply_changes: {
        Args: { changes: Json; firm: string }
        Returns: undefined
      }
      cancel_message: { Args: { id: string }; Returns: Json }
      claim_phone_send_job: {
        Args: { device: string }
        Returns: {
          body: string | null
          claim_id: string | null
          claimed_at: string | null
          created_at: string
          device_id: string
          error: string | null
          expires_at: string
          id: string
          lease_expires_at: string | null
          outbox_id: string | null
          reported_at: string | null
          status: string
          to_phone: string
        }[]
        SetofOptions: {
          from: "*"
          to: "phone_send_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_firm: {
        Args: { display_name: string; name: string }
        Returns: string
      }
      decide_agent_proposal: {
        Args: { decision: string; proposal: string }
        Returns: boolean
      }
      document_is_owner_only: {
        Args: {
          file_status: string
          kind: string
          storage_path: string
          type_id: string
        }
        Returns: boolean
      }
      document_is_readable: { Args: { document: string }; Returns: boolean }
      document_type_is_open: { Args: { type: string }; Returns: boolean }
      edit_agent_proposal: {
        Args: { payload: Json; proposal: string }
        Returns: boolean
      }
      file_document: {
        Args: {
          action?: string
          document: string
          school_year?: string
          student?: string
          title: string
          type: string
        }
        Returns: undefined
      }
      is_firm_member: { Args: { firm: string }; Returns: boolean }
      is_firm_owner: { Args: { firm: string }; Returns: boolean }
      log_meeting_drafts_ready: { Args: { meeting: string }; Returns: Json }
      owner_only_file_count: {
        Args: { firm: string; students?: string[] }
        Returns: number
      }
      path_uuid: { Args: { path: string; segment: number }; Returns: string }
      queue_message: { Args: { payload: Json }; Returns: Json }
      reserve_agent_call: {
        Args: { day_limit: number; firm: string }
        Returns: boolean
      }
      seed_document_types: { Args: { firm: string }; Returns: undefined }
      student_link_write: {
        Args: {
          p_activity: string
          p_document?: Json
          p_firm: string
          p_patch: Json
          p_student: string
          p_task: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
