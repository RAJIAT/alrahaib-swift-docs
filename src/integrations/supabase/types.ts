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
      agents: {
        Row: {
          active: boolean
          branch: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          supervisor_user_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          branch?: string | null
          created_at?: string
          email?: string | null
          id: string
          name: string
          supervisor_user_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          branch?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          supervisor_user_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_url: string | null
          body: string | null
          created_at: string
          id: string
          sender_name: string | null
          sender_role: Database["public"]["Enums"]["app_role"]
          sender_user_id: string
          thread_id: string
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          sender_name?: string | null
          sender_role: Database["public"]["Enums"]["app_role"]
          sender_user_id: string
          thread_id: string
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          sender_name?: string | null
          sender_role?: Database["public"]["Enums"]["app_role"]
          sender_user_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_reads: {
        Row: {
          last_read_at: string
          thread_id: string
          user_id: string
        }
        Insert: {
          last_read_at?: string
          thread_id: string
          user_id: string
        }
        Update: {
          last_read_at?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_reads_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          agent_id: string
          agent_user_id: string
          created_at: string
          id: string
          last_message_at: string | null
          supervisor_user_id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          agent_user_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          supervisor_user_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          agent_user_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          supervisor_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      requests: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          branch: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          display_id: string | null
          emirates: string | null
          id: string
          license: string | null
          passport: string | null
          registration: string | null
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
          vehicle_photos: string[] | null
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          branch?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          display_id?: string | null
          emirates?: string | null
          id?: string
          license?: string | null
          passport?: string | null
          registration?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          vehicle_photos?: string[] | null
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          branch?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          display_id?: string | null
          emirates?: string | null
          id?: string
          license?: string | null
          passport?: string | null
          registration?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          vehicle_photos?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_thread_participant: {
        Args: { _thread_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "agent" | "supervisor"
      request_status: "new" | "processing" | "sold" | "rejected" | "reupload"
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
  public: {
    Enums: {
      app_role: ["admin", "agent", "supervisor"],
      request_status: ["new", "processing", "sold", "rejected", "reupload"],
    },
  },
} as const
