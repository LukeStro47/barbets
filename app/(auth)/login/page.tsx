import { AuthTabs } from '@/components/auth/AuthTabs';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string; error?: string }>;
}) {
  const { next, mode, error } = await searchParams;

  // AuthTabs renders the whole screen (headline included) because sign in and sign up differ by
  // more than their fields, and the switch between them stays client-side on this one route.
  return <AuthTabs defaultMode={mode === 'signup' ? 'signup' : 'signin'} next={next} error={error} />;
}
