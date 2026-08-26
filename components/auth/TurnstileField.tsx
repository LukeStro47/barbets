'use client';

import { useEffect, useRef } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Drop inside a <form> that posts to a Server Action. The widget renders its own hidden
 * `cf-turnstile-response` input as part of the DOM, so it rides along in the form's FormData
 * with no extra wiring, the server action just reads `formData.get('cf-turnstile-response')`.
 *
 * `appearance: 'interaction-only'` is the "more invisible the better" setting: the widget takes
 * up no space and shows nothing unless Cloudflare actually needs the visitor to interact.
 *
 * Renders nothing when no site key is configured, so local dev (no Cloudflare set up) keeps
 * working. Production always has NEXT_PUBLIC_TURNSTILE_SITE_KEY set.
 */
export function TurnstileField({ resetKey }: { resetKey?: unknown }) {
  const ref = useRef<TurnstileInstance>(null);
  const prevResetKey = useRef(resetKey);

  useEffect(() => {
    if (resetKey !== prevResetKey.current) {
      prevResetKey.current = resetKey;
      // A token is single-use - after a failed submit (wrong password, business-rule error) the
      // one already spent needs replacing before the next attempt, or Supabase rejects it outright.
      ref.current?.reset();
    }
  }, [resetKey]);

  if (!SITE_KEY) return null;

  return <Turnstile ref={ref} siteKey={SITE_KEY} options={{ appearance: 'interaction-only' }} />;
}
