import { redirect } from "next/navigation";
import { ChatApp } from "@/components/chat/chat-app";
import { createClient } from "@/lib/supabase/server";

export default async function ChatPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  return <ChatApp userId={userId} />;
}