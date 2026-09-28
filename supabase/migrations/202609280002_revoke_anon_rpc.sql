revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.get_or_create_conversation(uuid) from public, anon;
revoke all on function public.list_conversations() from public, anon;
revoke all on function public.set_presence(boolean) from public, anon;