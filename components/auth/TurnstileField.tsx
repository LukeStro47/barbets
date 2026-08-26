'use client';

import { useEffect, useRef, useState } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Drop inside a <form> that posts to a Server Action. The widget renders its own hidden
 * `cf-turnstile-response` input as part of the DOM, so it rides along in the form's FormData
 * with no extra wiring, the server action just reads `formData.get('cf-turnstile-response')`.
 *
 * `appearance: 'interaction-only'` is the "more invisible the better" setting: the widget takes
 * up no space and shows nothing unless Cloudflare actually needs the visitor to interact.
 * `size: 'flexible'` fills the container's width instead of the fixed 300px `'normal'` box, which
 * on a narrow phone screen sat oddly against the full-width fields around it.
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

  return (
    <Turnstile
      ref={ref}
      siteKey={SITE_KEY}
      options={{ appearance: 'interaction-only', size: 'flexible' }}
    />
  );
}

/**
 * Same protection as `TurnstileField`, but for actions that shouldn't ask the visitor to prove
 * they're human just because the surrounding form mounted. Used for `ConfirmEmailForm`'s resend
 * button, which used to carry its own always-mounted `TurnstileField` right next to the sign-up
 * form's - since that widget starts its risk check the instant it renders, Cloudflare would often
 * ask for a second, separate check immediately after the person had just cleared one to create the
 * account, before they'd even touched "resend". With `execution`/`appearance: 'execute'`, nothing
 * runs until `ref.execute()` is called, which happens here on click, so the check (if Cloudflare
 * decides one is even needed) only happens for someone who actually asks for another email.
 *
 * Renders a plain submit button when no site key is configured, matching `TurnstileField`'s local
 * dev passthrough.
 */
export function DeferredTurnstileButton({
  formRef,
  resetKey,
  disabled,
  className,
  children,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  resetKey?: unknown;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<TurnstileInstance>(null);
  const prevResetKey = useRef(resetKey);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (resetKey !== prevResetKey.current) {
      prevResetKey.current = resetKey;
      ref.current?.reset();
    }
  }, [resetKey]);

  if (!SITE_KEY) {
    return (
      <button type="submit" disabled={disabled} className={className}>
        {children}
      </button>
    );
  }

  async function handleClick() {
    setVerifying(true);
    try {
      ref.current?.execute();
      await ref.current?.getResponsePromise();
      formRef.current?.requestSubmit();
    } catch {
      // Cloudflare failed or timed out - reset so the widget is clean for the next click.
      ref.current?.reset();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <Turnstile
        ref={ref}
        siteKey={SITE_KEY}
        options={{ appearance: 'execute', execution: 'execute', size: 'flexible' }}
      />
      <button type="button" onClick={handleClick} disabled={disabled || verifying} className={className}>
        {children}
      </button>
    </>
  );
}
