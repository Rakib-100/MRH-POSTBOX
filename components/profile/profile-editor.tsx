"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Camera, Check, LoaderCircle, LogOut, MessageSquareText } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/database.types";
import { useRouter } from "next/navigation";

export function ProfileEditor() {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (mounted && data) {
        setProfile(data);
        setFullName(data.full_name);
        setBio(data.bio);
      }
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [router, supabase]);

  useEffect(() => () => {
    if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
  }, []);

  function choosePhoto(file: File | undefined) {
    setError("");
    setNotice("");
    if (!file) return;
    if (!file.type.startsWith("image/") || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Images must be smaller than 5 MB.");
      return;
    }
    if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
    const preview = URL.createObjectURL(file);
    photoPreviewRef.current = preview;
    setPhotoPreview(preview);
    setPhoto(file);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!profile || !fullName.trim()) {
      setError("Your name cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      let avatarUrl = profile.avatar_url;
      if (photo) {
        const extension = photo.type === "image/jpeg" ? "jpg" : photo.type.split("/")[1];
        const path = `${profile.id}/${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("avatars").upload(path, photo, {
          contentType: photo.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }
      const { data, error: updateError } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim(), bio: bio.trim(), avatar_url: avatarUrl })
        .eq("id", profile.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      setProfile(data);
      if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
      photoPreviewRef.current = null;
      setPhotoPreview(null);
      setPhoto(null);
      setNotice("Your profile has been updated.");
    } catch {
      setError("We couldn't save your changes. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    if (profile) await supabase.rpc("set_presence", { online: false });
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-[var(--paper)] text-sm text-[var(--muted)]">Loading profile...</main>;
  }

  return (
    <main className="auth-grid min-h-screen bg-[var(--paper)] px-5 py-6 sm:px-10 sm:py-9">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between">
          <Link href="/chat" className="brand-lockup"><span className="brand-mark"><MessageSquareText size={18} /></span><span>MRH-<b>POSTBOX</b></span></Link>
          <button className="icon-button" onClick={() => void handleLogout()} title="Sign out" aria-label="Sign out"><LogOut size={18} /></button>
        </header>

        <div className="mx-auto grid w-full flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-20">
          <section className="max-w-lg">
            <Link href="/chat" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]"><ArrowLeft size={16} /> Back to messages</Link>
            <p className="eyebrow mt-10">A little about you</p>
            <h1 className="mt-3 font-display text-5xl leading-tight text-[var(--ink)]">Your profile, <i className="text-[var(--coral)]">your way.</i></h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--muted)]">Help the people you know recognize you. Your User ID stays yours and cannot be changed.</p>
            <div className="mt-10 flex items-center gap-3 text-sm text-[var(--muted)]"><span className="online-dot" /> Your profile is only visible to signed-in members.</div>
          </section>

          <section className="auth-panel">
            {profile && (
              <form onSubmit={(event) => void handleSave(event)}>
                <div className="mb-7 flex items-center gap-4">
                  <div className="relative">
                    <Avatar name={fullName || profile.full_name} imageUrl={photoPreview ?? profile.avatar_url} size="lg" />
                    <button type="button" className="photo-button" onClick={() => fileInputRef.current?.click()} aria-label="Choose a profile picture"><Camera size={17} /></button>
                    <input ref={fileInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choosePhoto(event.target.files?.[0])} />
                  </div>
                  <div><p className="font-semibold text-[var(--ink)]">Profile picture</p><p className="mt-1 text-xs text-[var(--muted)]">JPG, PNG or WebP · up to 5 MB</p></div>
                </div>

                <label className="field-label">Full name<span className="field-wrap"><input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={80} required /></span></label>
                <label className="field-label mt-4">11-digit User ID<span className="field-wrap field-readonly"><span className="field-prefix">ID</span><input value={profile.user_id} readOnly aria-readonly="true" /><Check size={16} /></span></label>
                <label className="field-label mt-4">Short bio<span className="field-wrap field-textarea"><textarea value={bio} onChange={(event) => setBio(event.target.value.slice(0, 240))} maxLength={240} rows={3} placeholder="A line or two about you" /></span><span className="mt-1 block text-right text-[10px] font-normal text-[var(--muted)]">{bio.length}/240</span></label>

                {error && <p role="alert" className="form-notice form-error">{error}</p>}
                {notice && <p role="status" className="form-notice form-success">{notice}</p>}
                <button className="primary-button mt-5 w-full" type="submit" disabled={saving}>
                  {saving ? <><LoaderCircle className="animate-spin" size={17} /> Saving...</> : <>Save profile <Check size={17} /></>}
                </button>
              </form>
            )}
          </section>
        </div>
        <footer className="flex justify-between border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]"><span>MRH-POSTBOX</span><span>{profile ? `Member since ${new Date(profile.created_at).toLocaleDateString([], { month: "long", year: "numeric" })}` : ""}</span></footer>
      </div>
    </main>
  );
}