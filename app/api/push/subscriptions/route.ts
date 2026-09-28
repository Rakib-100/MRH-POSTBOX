import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PushSubscriptionPayload = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

function isValidSubscription(value: PushSubscriptionPayload) {
  if (typeof value.endpoint !== "string" || value.endpoint.length > 2048) return false;
  if (typeof value.keys?.p256dh !== "string" || typeof value.keys.auth !== "string") return false;
  try {
    return new URL(value.endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null) as { subscription?: PushSubscriptionPayload } | null;
  const subscription = body?.subscription;
  if (!subscription || !isValidSubscription(subscription)) {
    return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("push_subscriptions").upsert({
      user_id: user.id,
      endpoint: subscription.endpoint as string,
      p256dh: subscription.keys?.p256dh as string,
      auth: subscription.keys?.auth as string,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });

    if (error) return Response.json({ error: "Could not save push subscription" }, { status: 500 });
    return Response.json({ subscribed: true });
  } catch {
    return Response.json({ error: "Push service is not configured" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 2048) {
    return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("push_subscriptions").delete()
      .eq("user_id", user.id)
      .eq("endpoint", body.endpoint);

    if (error) return Response.json({ error: "Could not remove push subscription" }, { status: 500 });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Push service is not configured" }, { status: 503 });
  }
}