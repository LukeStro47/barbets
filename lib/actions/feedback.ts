'use server';

import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

interface Feedback {
  id: string;
  message: string;
  page_url: string | null;
  created_at: string;
}

/** Slack webhook needs no secret Next.js can't hold (unlike VAPID/FCM, which are Edge-Function-only),
    so this posts directly instead of routing through notification_events/send-push. Best-effort:
    a Slack outage never fails the submission, since the feedback is already durably saved in
    Postgres by the time this runs. */
async function postToSlack(message: string, pageUrl: string | null, who: string): Promise<void> {
  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `New feedback from ${who}${pageUrl ? ` (${pageUrl})` : ''}:\n${message}`,
      }),
    });
  } catch (err) {
    console.error('postToSlack failed:', err);
  }
}

export async function submitFeedback(message: string, pageUrl: string | null): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<Feedback>(await supabase.rpc('submit_feedback', { p_message: message, p_page_url: pageUrl }));
  if (result.error) return result;
  const feedback = result.data as Feedback;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = user
    ? await supabase.from('memberships').select('nickname').eq('user_id', user.id).neq('status', 'removed').limit(1).maybeSingle()
    : { data: null };
  const who = membership?.nickname ? `@${membership.nickname} (${user?.email})` : (user?.email ?? 'someone');

  await postToSlack(feedback.message, feedback.page_url, who);
  return { data: null };
}
