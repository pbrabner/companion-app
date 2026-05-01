/**
 * Auto-generated Supabase database types. DO NOT EDIT BY HAND.
 * Regenerate via `pnpm db:types`.
 * @module shared/db/types
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      checkins: {
        Row: {
          created_at: string
          focus: string | null
          id: string
          intent: string | null
          mood: number | null
          user_id: string
          weight: string | null
        }
        Insert: {
          created_at?: string
          focus?: string | null
          id?: string
          intent?: string | null
          mood?: number | null
          user_id: string
          weight?: string | null
        }
        Update: {
          created_at?: string
          focus?: string | null
          id?: string
          intent?: string | null
          mood?: number | null
          user_id?: string
          weight?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          ended_at: string | null
          id: string
          started_at: string
          track_slug: string | null
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          started_at?: string
          track_slug?: string | null
          user_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          started_at?: string
          track_slug?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_track_slug_fkey"
            columns: ["track_slug"]
            isOneToOne: false
            referencedRelation: "tracks_catalog"
            referencedColumns: ["slug"]
          },
        ]
      }
      journal_entries: {
        Row: {
          body: string
          created_at: string
          id: string
          prompt_used: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          prompt_used?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          prompt_used?: string | null
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          model: string | null
          role: string
          safety_flag: string | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          model?: string | null
          role: string
          safety_flag?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          model?: string | null
          role?: string
          safety_flag?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_track: string | null
          created_at: string
          display_name: string | null
          id: string
          onboarded_at: string | null
          privacy_accepted_at: string | null
        }
        Insert: {
          active_track?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          onboarded_at?: string | null
          privacy_accepted_at?: string | null
        }
        Update: {
          active_track?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          onboarded_at?: string | null
          privacy_accepted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_track_fkey"
            columns: ["active_track"]
            isOneToOne: false
            referencedRelation: "tracks_catalog"
            referencedColumns: ["slug"]
          },
        ]
      }
      safety_events: {
        Row: {
          action_taken: string
          classifier: string | null
          created_at: string
          id: string
          trigger_text: string
          user_id: string
        }
        Insert: {
          action_taken: string
          classifier?: string | null
          created_at?: string
          id?: string
          trigger_text: string
          user_id: string
        }
        Update: {
          action_taken?: string
          classifier?: string | null
          created_at?: string
          id?: string
          trigger_text?: string
          user_id?: string
        }
        Relationships: []
      }
      track_progress: {
        Row: {
          completed_at: string | null
          current_step: number
          track_slug: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          current_step?: number
          track_slug: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          current_step?: number
          track_slug?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_progress_track_slug_fkey"
            columns: ["track_slug"]
            isOneToOne: false
            referencedRelation: "tracks_catalog"
            referencedColumns: ["slug"]
          },
        ]
      }
      tracks_catalog: {
        Row: {
          created_at: string
          description: string
          slug: string
          steps_total: number
          title: string
        }
        Insert: {
          created_at?: string
          description: string
          slug: string
          steps_total: number
          title: string
        }
        Update: {
          created_at?: string
          description?: string
          slug?: string
          steps_total?: number
          title?: string
        }
        Relationships: []
      }
      usage_counters: {
        Row: {
          chat_msgs_day: number
          chat_msgs_hour: number
          day_bucket: string
          hour_bucket: string
          last_warning_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_msgs_day?: number
          chat_msgs_hour?: number
          day_bucket: string
          hour_bucket: string
          last_warning_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_msgs_day?: number
          chat_msgs_hour?: number
          day_bucket?: string
          hour_bucket?: string
          last_warning_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_insights: {
        Row: {
          generated_at: string
          patterns_json: Json
          user_id: string
        }
        Insert: {
          generated_at?: string
          patterns_json?: Json
          user_id: string
        }
        Update: {
          generated_at?: string
          patterns_json?: Json
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

