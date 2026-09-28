# MRH-POSTBOX

MRH-POSTBOX is a private, one-to-one messaging web app. Members create an account with an 11-digit User ID, find other members, and exchange text messages in real time.

## Features

- Supabase Auth registration and sign-in using an 11-digit User ID and password
- Private conversations with duplicate-safe creation
- Realtime text messages, read/unread counts, timestamps, and recent message history
- Profile name, bio, and profile picture editing
- Online status and last-seen heartbeat
- Android Web Push notifications, including when Chrome is backgrounded or closed
- Mobile chat layout follows the visible viewport when the on-screen keyboard opens
- Responsive conversation list and chat view
- PostgreSQL Row Level Security for profiles, conversations, messages, and avatar uploads

## Stack

Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth, Supabase PostgreSQL, Supabase Realtime, Supabase Storage, and Vercel.

## Requirements

- Node.js 20.9 or newer
- npm
- A Supabase project

## Install and configure

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.local.example` to `.env.local` and set the API URL and anon key from **Supabase Dashboard → Project Settings → API** (or the project's Connect dialog):

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
   ```

   The URL, anon key, and VAPID public key are public client configuration. Never expose the service-role key or VAPID private key in browser code or commit real credentials.

3. Apply the database migration. In the Supabase Dashboard, open **SQL Editor**, create a query, paste the contents of [`supabase/migrations/202609280001_initial_schema.sql`](supabase/migrations/202609280001_initial_schema.sql), and run it. It creates the tables, Auth profile trigger, RLS policies, RPC functions, avatar bucket/policies, indexes, and Realtime publication entry.

   If the initial schema has already been applied, also run [`supabase/migrations/202609280002_revoke_anon_rpc.sql`](supabase/migrations/202609280002_revoke_anon_rpc.sql) in the SQL Editor. It removes anonymous execution grants from the private chat RPC functions.

   Run [`supabase/migrations/202609280003_android_web_push.sql`](supabase/migrations/202609280003_android_web_push.sql) too. Push subscriptions are only accessible to server-side service-role operations; browser clients have no table grants.

4. Generate a VAPID key pair:

   ```bash
   npx web-push generate-vapid-keys
   ```

   Add the generated values to `.env.local` and Vercel. Get the `service_role` key from **Supabase Dashboard → Project Settings → API**:

   ```env
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=generated_public_key
   VAPID_PRIVATE_KEY=generated_private_key
   VAPID_SUBJECT=mailto:your-contact@example.com
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

   Only the VAPID public key is browser-visible. Keep the private VAPID key and service-role key server-only.

5. Configure Supabase Auth:
   - Under **Authentication → Providers → Email**, turn **off email confirmations**. The public User ID is mapped internally to a non-deliverable email address so it can use Supabase's password Auth; confirmation emails cannot be delivered to that address.
   - Under **Authentication → URL Configuration**, set the Site URL to `http://localhost:3000` for local work and add `http://localhost:3000/**` to Redirect URLs. Add the production and preview URLs after deployment.
   - Use Supabase Auth's password security settings as appropriate for your project.

6. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

Useful checks:

```bash
npm run lint
npm run build
```

## Publish on GitHub

Create or use the GitHub repository `https://github.com/Rakib-100/MRH-POSTBOX`. From the project folder, connect it if needed and push your branch:

```bash
git remote add origin https://github.com/Rakib-100/MRH-POSTBOX.git
git add .
git commit -m "Build MRH-POSTBOX chat app"
git push -u origin HEAD
```

If `origin` already exists, do not add it again. `.env.local` is ignored by Git; keep actual Supabase credentials out of commits.

## Deploy on Vercel

1. Import the GitHub repository into Vercel and keep the detected Next.js settings.
2. In **Project Settings → Environment Variables**, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` as public Config values. Set `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `SUPABASE_SERVICE_ROLE_KEY` as Secret/server-only values. Apply to Production (and Preview if used).
3. Deploy. In Supabase **Authentication → URL Configuration**, set the Site URL to your production URL (for example `https://mrh-postbox.vercel.app`) and add these Redirect URLs:
   - `http://localhost:3000/**`
   - `https://mrh-postbox.vercel.app/**`
   - `https://*-<your-vercel-team-slug>.vercel.app/**` if Vercel preview deployments should be allowed
4. Redeploy after changing Vercel environment variables. Confirm the migration has run on the same Supabase project used by the deployment.

## Security notes and limitations

- The internal email identifier is derived from the public 11-digit ID; it is not a password or a secret. Passwords are handled only by Supabase Auth.
- The Auth trigger creates a profile in the same database transaction as Auth user creation, so a failed profile insert fails registration too.
- RLS derives identity from the verified Supabase session. The browser never receives a service-role key.
- Avatar images are in a public-read bucket because they are profile pictures; writes are limited to the signed-in user's own folder.
- Presence is a lightweight heartbeat. A browser that loses power or network without signing out can appear online until its last heartbeat becomes stale; the interface treats heartbeats older than 90 seconds as offline.
- Android push requires HTTPS, the push migration, VAPID keys, the server-only service-role key, and the user to enable notifications from Android Chrome in the chat page. A LAN HTTP address is not a secure context.
- Push subscriptions are device/browser-specific. Each Android device must enable notifications separately.
- The chat loads the latest 100 messages per conversation. This MVP does not include message pagination, password reset, email verification, attachments, or group chat.
- A live Supabase project and its URL/key are required to exercise registration, chat, storage, and Realtime. No credentials are included in this repository.
