"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Search,
  Send,
  SmilePlus,
  UserRound,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import type { ConversationSummary, Message, SearchProfile } from "@/lib/supabase/database.types";
import { useRouter } from "next/navigation";

type PushStatus = "checking" | "unsupported" | "setup-required" | "unsubscribed" | "subscribed" | "denied" | "error";

function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function presenceLabel(profile: Pick<SearchProfile, "is_online" | "last_seen">) {
  const recent = Date.now() - new Date(profile.last_seen).getTime() < 90_000;
  if (profile.is_online && recent) return "Online now";
  const elapsed = Date.now() - new Date(profile.last_seen).getTime();
  if (elapsed < 60 * 60_000) return `Last seen ${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `Last seen ${Math.floor(elapsed / (60 * 60_000))}h ago`;
  return `Last seen ${new Date(profile.last_seen).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export function ChatApp({ userId }: { userId: string }) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [profile, setProfile] = useState<SearchProfile | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<SearchProfile[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [error, setError] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const chatViewportRef = useRef<HTMLElement>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus>("checking");

  const loadConversations = useCallback(async () => {
    const { data } = await supabase.rpc("list_conversations");
    if (data) setConversations(data);
    setLoadingConversations(false);
  }, [supabase]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      supabase.from("profiles").select("id,user_id,full_name,avatar_url,bio,is_online,last_seen").eq("id", userId).single(),
      supabase.rpc("list_conversations"),
      supabase.rpc("set_presence", { online: true }),
    ]).then(([profileResponse, conversationsResponse]) => {
      if (!mounted) return;
      if (profileResponse.data) setProfile(profileResponse.data);
      if (conversationsResponse.data) {
        setConversations(conversationsResponse.data);
        if (conversationsResponse.data[0]) setActive(conversationsResponse.data[0]);
      }
      setLoadingConversations(false);
    });

    const refreshTimer = window.setInterval(() => {
      void supabase.rpc("set_presence", { online: true });
      void loadConversations();
    }, 45_000);
    const handleVisibility = () => {
      void supabase.rpc("set_presence", { online: !document.hidden });
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      void supabase.rpc("set_presence", { online: false });
    };
  }, [loadConversations, supabase, userId]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!/android/i.test(navigator.userAgent) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushStatus("unsupported");
        return;
      }
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        setPushStatus("setup-required");
        return;
      }
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!mounted) return;
        if (!subscription) {
          setPushStatus("unsubscribed");
          return;
        }
        const response = await fetch("/api/push/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
        setPushStatus(response.ok ? "subscribed" : "error");
      } catch {
        if (mounted) setPushStatus("error");
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const incomingChannel = supabase
      .channel(`incoming-messages:${userId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `receiver_id=eq.${userId}`,
      }, (payload) => {
        void (payload.new as Message);
        void loadConversations();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(incomingChannel);
    };
  }, [loadConversations, supabase, userId]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const chatViewport = chatViewportRef.current;
    if (!viewport || !chatViewport) return;

    const updateChatViewport = () => {
      chatViewport.style.setProperty("--chat-visible-height", `${viewport.height}px`);
      chatViewport.style.setProperty("--chat-visible-top", `${viewport.offsetTop}px`);
    };

    updateChatViewport();
    viewport.addEventListener("resize", updateChatViewport);
    viewport.addEventListener("scroll", updateChatViewport);
    window.addEventListener("resize", updateChatViewport);

    return () => {
      viewport.removeEventListener("resize", updateChatViewport);
      viewport.removeEventListener("scroll", updateChatViewport);
      window.removeEventListener("resize", updateChatViewport);
    };
  }, []);

  useEffect(() => {
    const term = deferredQuery.trim();
    if (term.length < 2) return;
    let current = true;
    const timeout = window.setTimeout(async () => {
      const { data, error: searchError } = await supabase.rpc("search_profiles", { search_query: term });
      if (!current) return;
      if (searchError) setError("Search is temporarily unavailable.");
      setResults(data ?? []);
      setResultQuery(term);
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [deferredQuery, supabase]);

  useEffect(() => {
    if (!active) return;
    let alive = true;

    void supabase
      .from("messages")
      .select("id,conversation_id,sender_id,receiver_id,message_text,is_read,created_at")
      .eq("conversation_id", active.id)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(async ({ data, error: messageError }) => {
        if (!alive) return;
        if (messageError) setError("Could not load this conversation.");
        setMessages((data ?? []).reverse());
        setLoadedConversationId(active.id);
        if (document.visibilityState === "visible") {
          await supabase
            .from("messages")
            .update({ is_read: true })
            .eq("conversation_id", active.id)
            .eq("receiver_id", userId)
            .eq("is_read", false);
          void loadConversations();
        }
      });

    const markVisibleMessagesRead = () => {
      if (document.visibilityState !== "visible") return;
      void supabase
        .from("messages")
        .update({ is_read: true })
        .eq("conversation_id", active.id)
        .eq("receiver_id", userId)
        .eq("is_read", false)
        .then(() => loadConversations());
    };
    document.addEventListener("visibilitychange", markVisibleMessagesRead);

    const channel = supabase
      .channel(`messages:${active.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${active.id}`,
      }, (payload) => {
        const incoming = payload.new as Message;
        setMessages((current) => current.some((message) => message.id === incoming.id)
          ? current
          : [...current, incoming]);
        if (incoming.receiver_id === userId && document.visibilityState === "visible") {
          void supabase.from("messages").update({ is_read: true }).eq("id", incoming.id).eq("receiver_id", userId);
          void loadConversations();
        }
        void loadConversations();
      })
      .subscribe();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", markVisibleMessagesRead);
      void supabase.removeChannel(channel);
    };
  }, [active, loadConversations, supabase, userId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function openProfile(target: SearchProfile) {
    setError("");
    const { data, error: openError } = await supabase.rpc("get_or_create_conversation", {
      other_user_id: target.id,
    });
    if (openError || !data) {
      setError("Could not open that conversation. Please try again.");
      return;
    }
    const existing = conversations.find((conversation) => conversation.id === data);
    const conversation: ConversationSummary = existing ?? {
      ...target,
      other_id: target.id,
      id: data,
      latest_message: null,
      latest_at: null,
      unread_count: 0,
    };
    setActive(conversation);
    setMobileChatOpen(true);
    setQuery("");
    setResults([]);
    await loadConversations();
  }

  async function handleSend(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = messageText.trim();
    if (!active || !text || text.length > 4000 || sending) return;
    setSending(true);
    setError("");
    const { data, error: sendError } = await supabase
      .from("messages")
      .insert({
        conversation_id: active.id,
        sender_id: userId,
        receiver_id: active.other_id,
        message_text: text,
      })
      .select("id,conversation_id,sender_id,receiver_id,message_text,is_read,created_at")
      .single();
    if (sendError || !data) {
      setError("Your message could not be sent. Please try again.");
    } else {
      setMessages((current) => current.some((message) => message.id === data.id) ? current : [...current, data]);
      setMessageText("");
      void loadConversations();
      void fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: data.id }),
      }).catch(() => undefined);
    }
    setSending(false);
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  async function handleLogout() {
    await supabase.rpc("set_presence", { online: false });
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function toggleAndroidPush() {
    if (
      !/android/i.test(navigator.userAgent) ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setPushStatus("unsupported");
      return;
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setPushStatus("setup-required");
      return;
    }

    setPushStatus("checking");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error("Could not remove push subscription");
        await subscription.unsubscribe();
        setPushStatus("unsubscribed");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus(permission === "denied" ? "denied" : "unsubscribed");
        return;
      }
      const newSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(publicKey),
      });
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: newSubscription.toJSON() }),
      });
      if (!response.ok) {
        await newSubscription.unsubscribe();
        throw new Error("Could not save push subscription");
      }
      setPushStatus("subscribed");
    } catch {
      setPushStatus("error");
    }
  }

  const pushLabel = pushStatus === "subscribed"
    ? "Android push notifications are enabled"
    : pushStatus === "denied"
      ? "Allow notifications in Android app settings"
      : pushStatus === "unsupported"
        ? "Android Chrome push notifications are not available here"
        : pushStatus === "setup-required"
          ? "Push notification keys are not configured"
          : pushStatus === "error"
            ? "Could not set up Android push notifications"
            : pushStatus === "checking"
              ? "Checking Android push notifications"
              : "Enable Android push notifications";

  const showingSearch = query.trim().length >= 2;
  const searching = showingSearch && deferredQuery.trim() !== resultQuery;
  const loadingMessages = Boolean(active && loadedConversationId !== active.id);
  const activePresence = active
    ? conversations.find((conversation) => conversation.id === active.id) ?? active
    : null;

  return (
    <main
      ref={chatViewportRef}
      style={{ height: "var(--chat-visible-height, 100dvh)", top: "var(--chat-visible-top, 0px)" }}
      className="fixed inset-x-0 top-0 overflow-hidden bg-[var(--paper)] p-0 sm:p-4 lg:p-6"
    >
      <div className="chat-frame mx-auto flex h-full max-w-[1500px] overflow-hidden bg-white sm:rounded-[8px]">
        <aside className={`chat-sidebar flex w-full shrink-0 flex-col border-r border-[var(--line)] bg-[var(--paper)] sm:w-[340px] lg:w-[370px] ${mobileChatOpen ? "hidden sm:flex" : "flex"}`}>
          <div className="flex items-center justify-between px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
            <Link href="/" className="brand-lockup" aria-label="MRH-POSTBOX home">
              <span className="brand-mark"><MessageCircle size={18} strokeWidth={2.1} /></span>
              <span>MRH-<b>POSTBOX</b></span>
            </Link>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void toggleAndroidPush()}
                className="icon-button"
                aria-label={pushLabel}
                title={pushLabel}
                disabled={pushStatus === "checking" || pushStatus === "unsupported" || pushStatus === "setup-required"}
              >
                {pushStatus === "subscribed" ? <Bell size={18} /> : <BellOff size={18} />}
              </button>
              <Link href="/profile" className="icon-button" aria-label="Edit profile" title="Profile"><UserRound size={18} /></Link>
              <button onClick={handleLogout} className="icon-button" aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
            </div>
          </div>

          <div className="px-5 sm:px-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="eyebrow">Your people</p>
                <h1 className="font-display text-2xl text-[var(--ink)]">Messages</h1>
              </div>
              <span className="text-xs text-[var(--muted)]">{conversations.length} chats</span>
            </div>
            <label className="search-field">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find someone by name or ID" aria-label="Search people" />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button>}
            </label>
            <p className="mt-2 px-1 text-[11px] text-[var(--muted)]">Search registered people to start a private chat</p>
          </div>

          <div className="conversation-scroll mt-5 flex-1 overflow-y-auto px-3 pb-3 sm:px-4">
            {showingSearch ? (
              <>
                <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">People</p>
                {searching ? <p className="px-2 py-6 text-sm text-[var(--muted)]">Searching...</p> : results.length === 0 ? (
                  <p className="px-2 py-6 text-sm text-[var(--muted)]">No users found</p>
                ) : results.map((result) => (
                  <button key={result.id} className="search-result" onClick={() => void openProfile(result)}>
                    <Avatar name={result.full_name} imageUrl={result.avatar_url} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-semibold text-[var(--ink)]">{result.full_name}</span>
                      <span className="mt-1 block truncate text-xs text-[var(--muted)]">ID {result.user_id} · {result.bio || (result.is_online ? "Online" : "Away")}</span>
                    </span>
                    <ArrowUpRight size={16} className="text-[var(--muted)]" />
                  </button>
                ))}
              </>
            ) : loadingConversations ? (
              <p className="px-2 py-6 text-sm text-[var(--muted)]">Loading conversations...</p>
            ) : conversations.length === 0 ? (
              <div className="empty-list px-5 py-12 text-center">
                <span className="empty-icon"><MessageCircle size={22} /></span>
                <p className="mt-4 font-display text-xl text-[var(--ink)]">No conversations yet</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Search for someone above and say hello.</p>
              </div>
            ) : conversations.map((conversation) => (
              <button key={conversation.id} onClick={() => { setError(""); setActive(conversation); setMobileChatOpen(true); }} className={`conversation-row ${active?.id === conversation.id ? "conversation-row-active" : ""}`}>
                <div className="relative">
                  <Avatar name={conversation.full_name} imageUrl={conversation.avatar_url} />
                  {presenceLabel(conversation) === "Online now" && <span className="avatar-presence" />}
                </div>
                <span className="min-w-0 flex-1 text-left">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-[var(--ink)]">{conversation.full_name}</span>
                    <span className="shrink-0 text-[10px] text-[var(--muted)]">{formatTime(conversation.latest_at)}</span>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-[var(--muted)]">{conversation.latest_message || "Start a conversation"}</span>
                    {conversation.unread_count > 0 && <span className="unread-count">{conversation.unread_count}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="sidebar-user flex items-center gap-3 border-t border-[var(--line)] px-5 py-4 sm:px-6">
            <Avatar name={profile?.full_name ?? "Your profile"} imageUrl={profile?.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">{profile?.full_name ?? "Your profile"}</p>
              <p className="text-xs text-[var(--muted)]">ID {profile?.user_id ?? "---------- -"}</p>
            </div>
            <span className="online-dot" title="Online" />
          </div>
        </aside>

        <section className={`chat-main min-w-0 flex-1 flex-col ${mobileChatOpen ? "flex" : "hidden sm:flex"}`}>
          {active ? (
            <>
              <header className="flex h-[78px] shrink-0 items-center gap-3 border-b border-[var(--line)] px-4 sm:px-7">
                <button className="icon-button sm:hidden" onClick={() => setMobileChatOpen(false)} aria-label="Back to conversations"><ArrowLeft size={20} /></button>
                <Avatar name={active.full_name} imageUrl={active.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-[var(--ink)]">{active.full_name}</h2>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{presenceLabel(activePresence ?? active)}</p>
                </div>
                <button className="icon-button" title="Conversation details" aria-label="Conversation details"><MoreHorizontal size={20} /></button>
              </header>

              {error && <div role="alert" className="mx-4 mt-3 flex items-center justify-between rounded-[4px] bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)] sm:mx-7"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={14} /></button></div>}

              <div className="message-wall flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
                <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end">
                  {loadingMessages ? (
                    <p className="py-12 text-center text-sm text-[var(--muted)]">Loading messages...</p>
                  ) : messages.length === 0 ? (
                    <div className="my-auto py-12 text-center">
                      <span className="empty-icon mx-auto"><SmilePlus size={22} /></span>
                      <h3 className="mt-4 font-display text-2xl text-[var(--ink)]">Start the conversation</h3>
                      <p className="mt-2 text-sm text-[var(--muted)]">A simple hello is a good place to begin.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messages.map((message, index) => {
                        const mine = message.sender_id === userId;
                        const showDate = index === 0 || new Date(message.created_at).toDateString() !== new Date(messages[index - 1].created_at).toDateString();
                        return (
                          <div key={message.id}>
                            {showDate && <p className="my-6 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">{new Date(message.created_at).toLocaleDateString([], { weekday: "short", month: "long", day: "numeric" })}</p>}
                            <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                              <div className={`message-bubble ${mine ? "message-mine" : "message-theirs"}`}>
                                <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.message_text}</p>
                                <span className={`mt-1.5 flex items-center justify-end gap-1 text-[10px] ${mine ? "text-white/70" : "text-[var(--muted)]"}`}>
                                  {formatTime(message.created_at)}{mine && (message.is_read ? <Check size={12} /> : <Check size={12} className="opacity-60" />)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messageEndRef} />
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-[var(--line)] bg-white px-4 py-4 sm:px-7 sm:py-5">
                <form onSubmit={(event) => void handleSend(event)} className="mx-auto flex max-w-3xl items-end gap-3">
                  <textarea
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value.slice(0, 4000))}
                    onKeyDown={handleMessageKeyDown}
                    rows={1}
                    maxLength={4000}
                    placeholder="Write a message..."
                    aria-label="Write a message"
                    className="message-input min-h-12 flex-1 resize-none"
                  />
                  <button className="send-button" type="submit" disabled={!messageText.trim() || sending} aria-label="Send message" title="Send message">
                    {sending ? <span className="send-spinner" /> : <Send size={18} />}
                  </button>
                </form>
                <p className="mx-auto mt-2 max-w-3xl text-[10px] text-[var(--muted)]">Enter to send · Shift + Enter for a new line</p>
              </div>
            </>
          ) : (
            <div className="welcome-panel flex flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="welcome-art"><MessageCircle size={35} strokeWidth={1.5} /><span /></div>
              <p className="eyebrow mt-8">MRH-POSTBOX</p>
              <h2 className="mt-3 max-w-md font-display text-4xl leading-tight text-[var(--ink)]">A good conversation starts with showing up.</h2>
              <p className="mt-4 max-w-sm text-sm leading-6 text-[var(--muted)]">Choose a conversation or look up someone you know.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}