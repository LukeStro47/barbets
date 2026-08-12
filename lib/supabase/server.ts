import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

/**
 * Per-request Supabase client built from the caller's session cookies —
 * every query through this client runs as that real user, subject to RLS.
 * This is the only client Server Components and Server Actions should use
 * to read or write on a user's behalf.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component (not a Server Action/Route
          // Handler) — cookies can't be written here. Harmless as long as
          // middleware.ts is also refreshing the session on every request.
        }
      },
    },
  });
}

/**
 * The signed-in user, or a redirect to /login. **Every page under `app/(app)` must call this
 * rather than `getUser()` directly.**
 *
 * `app/(app)/layout.tsx` already redirects when there's no user, and it is tempting to treat
 * that as the guard for everything beneath it — that assumption is exactly the bug this
 * exists to prevent. A layout and its page render **in parallel** in the App Router, so the
 * layout's `redirect()` cannot stop the page from running: both are already in flight. A page
 * that read `user!.id` on the strength of the layout's check threw
 * `TypeError: Cannot read properties of null (reading 'id')` in production every time a
 * session had quietly expired, which is invisible in development (where sessions rarely
 * lapse mid-session) and intermittent in production.
 *
 * The non-null assertion is the tell. If a page needs `user!.id`, it needs this instead.
 */
export async function requireUser(supabase: Awaited<ReturnType<typeof createClient>>): Promise<User> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // redirect() throws NEXT_REDIRECT, so nothing after this line runs for a signed-out caller.
  if (!user) redirect('/login');
  return user;
}
