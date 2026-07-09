import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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
