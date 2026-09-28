export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Profile = {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string;
  is_online: boolean;
  last_seen: string;
  created_at: string;
  updated_at: string;
};

export type SearchProfile = Pick<
  Profile,
  "id" | "user_id" | "full_name" | "avatar_url" | "bio" | "is_online" | "last_seen"
>;

export type ConversationSummary = SearchProfile & {
  other_id: string;
  latest_message: string | null;
  latest_at: string | null;
  unread_count: number;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  message_text: string;
  is_read: boolean;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: { id: string; user_id: string; full_name: string };
        Update: { full_name?: string; avatar_url?: string | null; bio?: string };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          user_one_id: string;
          user_two_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: { user_one_id: string; user_two_id: string };
        Update: never;
        Relationships: [];
      };
      messages: {
        Row: Message;
        Insert: {
          conversation_id: string;
          sender_id: string;
          receiver_id: string;
          message_text: string;
        };
        Update: { is_read?: boolean };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      search_profiles: { Args: { search_query: string }; Returns: SearchProfile[] };
      get_or_create_conversation: { Args: { other_user_id: string }; Returns: string };
      list_conversations: { Args: Record<string, never>; Returns: ConversationSummary[] };
      set_presence: { Args: { online: boolean }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};