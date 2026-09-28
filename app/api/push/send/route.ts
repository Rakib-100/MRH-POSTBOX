import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null) as { messageId?: unknown } | null;
  if (typeof body?.messageId !== "string" || !uuidPattern.test(body.messageId)) {
    return Response.json({ error: "Invalid message" }, { status: 400 });
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("id,conversation_id,sender_id,receiver_id,message_text")
    .eq("id", body.messageId)
    .eq("sender_id", user.id)
    .maybeSingle();
  if (messageError || !message) return Response.json({ error: "Message not found" }, { status: 404 });

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    return Response.json({ error: "Push service is not configured" }, { status: 503 });
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const admin = createAdminClient();
    const { data: claimedMessage, error: claimError } = await admin
      .from("messages")
      .update({ push_sent_at: new Date().toISOString() })
      .eq("id", message.id)
      .is("push_sent_at", null)
      .select("id")
      .maybeSingle();

    if (claimError) return Response.json({ error: "Could not queue notification" }, { status: 500 });
    if (!claimedMessage) return Response.json({ sent: false, reason: "already_processed" });

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", message.receiver_id);
    if (subscriptionsError) return Response.json({ error: "Could not load push subscriptions" }, { status: 500 });
    if (!subscriptions?.length) return Response.json({ sent: false, reason: "no_subscriptions" });

    const { data: sender } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const payload = JSON.stringify({
      title: sender?.full_name || "New message",
      body: message.message_text.slice(0, 160),
      url: "/chat",
      conversationId: message.conversation_id,
    });

    let sentCount = 0;
    const staleIds: string[] = [];
    let failedCount = 0;
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload);
        sentCount += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) staleIds.push(subscription.id);
        else failedCount += 1;
      }
    }));

    if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
    if (failedCount && !sentCount) return Response.json({ error: "Push delivery failed" }, { status: 502 });
    return Response.json({ sent: sentCount > 0 });
  } catch {
    return Response.json({ error: "Push service is not configured" }, { status: 503 });
  }
}