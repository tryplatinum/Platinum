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
      colleges: {
        Row: {
          created_at: string
          deadline: string
          firm_id: string
          fit: string
          id: string
          name: string
          note: string | null
          plan: string
          seq: number
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline: string
          firm_id: string
          fit: string
          id?: string
          name: string
          note?: string | null
          plan: string
          seq?: number
          status: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline?: string
          firm_id?: string
          fit?: string
          id?: string
          name?: string
          note?: string | null
          plan?: string
          seq?: number
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
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
      documents: {
        Row: {
          added_by: string
          added_on: string
          category: string
          created_at: string
          drafts: Json | null
          essay_group: string | null
          essay_prompt: string | null
          feedback: Json | null
          firm_id: string
          id: string
          kind: string
          name: string
          note: string | null
          seq: number
          status: string | null
          student_id: string
          target: string | null
          task_id: string | null
          topic: string | null
          updated_at: string
          url: string | null
          word_limit: number | null
        }
        Insert: {
          added_by: string
          added_on?: string
          category: string
          created_at?: string
          drafts?: Json | null
          essay_group?: string | null
          essay_prompt?: string | null
          feedback?: Json | null
          firm_id: string
          id?: string
          kind: string
          name: string
          note?: string | null
          seq?: number
          status?: string | null
          student_id: string
          target?: string | null
          task_id?: string | null
          topic?: string | null
          updated_at?: string
          url?: string | null
          word_limit?: number | null
        }
        Update: {
          added_by?: string
          added_on?: string
          category?: string
          created_at?: string
          drafts?: Json | null
          essay_group?: string | null
          essay_prompt?: string | null
          feedback?: Json | null
          firm_id?: string
          id?: string
          kind?: string
          name?: string
          note?: string | null
          seq?: number
          status?: string | null
          student_id?: string
          target?: string | null
          task_id?: string | null
          topic?: string | null
          updated_at?: string
          url?: string | null
          word_limit?: number | null
        }
        Relationships: [
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
            foreignKeyName: "documents_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
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
          updated_at: string
          weekly_text_day: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          weekly_text_day?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          weekly_text_day?: number
        }
        Relationships: []
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
          body: string
          body_en: string | null
          channel: string
          created_at: string
          dedupe_key: string | null
          firm_id: string
          id: string
          kind: string
          language: string
          note: string | null
          parent_id: string | null
          sent_at: string
          seq: number
          student_id: string
          task_id: string | null
          to_kind: string
          to_name: string
          trigger: string
          updated_at: string
        }
        Insert: {
          approval?: Json | null
          body: string
          body_en?: string | null
          channel: string
          created_at?: string
          dedupe_key?: string | null
          firm_id: string
          id?: string
          kind: string
          language: string
          note?: string | null
          parent_id?: string | null
          sent_at?: string
          seq?: number
          student_id: string
          task_id?: string | null
          to_kind: string
          to_name: string
          trigger: string
          updated_at?: string
        }
        Update: {
          approval?: Json | null
          body?: string
          body_en?: string | null
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          firm_id?: string
          id?: string
          kind?: string
          language?: string
          note?: string | null
          parent_id?: string | null
          sent_at?: string
          seq?: number
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
          firm_id: string
          id: string
          meeting_id: string | null
          seq: number
          source: string
          student_id: string
          text: string
          updated_at: string
        }
        Insert: {
          approval: Json
          created_at?: string
          event_date?: string | null
          firm_id: string
          id?: string
          meeting_id?: string | null
          seq?: number
          source: string
          student_id: string
          text: string
          updated_at?: string
        }
        Update: {
          approval?: Json
          created_at?: string
          event_date?: string | null
          firm_id?: string
          id?: string
          meeting_id?: string | null
          seq?: number
          source?: string
          student_id?: string
          text?: string
          updated_at?: string
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
      student_links: {
        Row: {
          created_at: string
          created_by: string | null
          firm_id: string
          id: string
          revoked_at: string | null
          student_id: string
          token: string | null
          token_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          firm_id: string
          id?: string
          revoked_at?: string | null
          student_id: string
          token?: string | null
          token_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          firm_id?: string
          id?: string
          revoked_at?: string | null
          student_id?: string
          token?: string | null
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
      apply_changes: {
        Args: { changes: Json; firm: string }
        Returns: undefined
      }
      create_firm: {
        Args: { display_name: string; name: string }
        Returns: string
      }
      is_firm_member: { Args: { firm: string }; Returns: boolean }
      is_firm_owner: { Args: { firm: string }; Returns: boolean }
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
