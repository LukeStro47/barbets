'use server';

import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

export type FeedbackCategory = 'bug' | 'idea' | 'general';

interface Feedback {
  id: string;
  message: string;
  category: FeedbackCategory;
  wants_followup: boolean;
  page_url: string | null;
  group_id: string | null;
  created_at: string;
}

const CATEGORY_META: Record<FeedbackCategory, { emoji: string; label: string }> = {
  bug: { emoji: '🐛', label: 'Bug report' },
  idea: { emoji: '💡', label: 'Idea' },
  general: { emoji: '💬', label: 'General feedback' },
};

/** A UUID group id embedded in a /groups/{id}/... page URL, if the referrer happened to be one. */
function extractGroupId(pageUrl: string | null): string | null {
  if (!pageUrl) return null;
  const match = pageUrl.match(/\/groups\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}

/** Slack Block Kit, not a single text blob — one field grid (name/email/group/follow-up) plus
    the full message below a divider, so it reads as a scannable card instead of a wall of text.
    Slack webhook needs no secret Next.js can't hold (unlike VAPID/FCM, which are Edge-Function-
    only), so this posts directly instead of routing through notification_events/send-push.
    Best-effort: a Slack outage never fails the submission, since the feedback is already durably
    saved in Postgres by the time this runs. */
async function postToSlack(feedback: {
  message: string;
  category: FeedbackCategory;
  wantsFollowup: boolean;
  nickname: string | null;
  email: string | null;
  groupId: string | null;
  groupName: string | null;
}): Promise<void> {
  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const { emoji, label } = CATEGORY_META[feedback.category];
  const groupField = feedback.groupId
    ? `${feedback.groupName ?? 'Unknown group'}\n\`${feedback.groupId}\``
    : '—';

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${emoji} New ${label.toLowerCase()} from ${feedback.nickname ? `@${feedback.nickname}` : (feedback.email ?? 'someone')}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${emoji} ${label}`, emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Name:*\n${feedback.nickname ? `@${feedback.nickname}` : '—'}` },
              { type: 'mrkdwn', text: `*Email:*\n${feedback.email ?? '—'}` },
              { type: 'mrkdwn', text: `*Group:*\n${groupField}` },
              { type: 'mrkdwn', text: `*Follow-up:*\n${feedback.wantsFollowup ? '✅ Wants a reply' : 'No'}` },
            ],
          },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: feedback.message },
          },
        ],
      }),
    });
  } catch (err) {
    console.error('postToSlack failed:', err);
  }
}

export async function submitFeedback(
  message: string,
  category: FeedbackCategory,
  wantsFollowup: boolean,
  pageUrl: string | null
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const groupId = extractGroupId(pageUrl);
  const result = await runRpc<Feedback>(
    await supabase.rpc('submit_feedback', {
      p_message: message,
      p_category: category,
      p_wants_followup: wantsFollowup,
      p_page_url: pageUrl,
      p_group_id: groupId,
    })
  );
  if (result.error) return result;
  const feedback = result.data as Feedback;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let nickname: string | null = null;
  let groupName: string | null = null;
  if (feedback.group_id) {
    const { data: m } = await supabase
      .from('memberships')
      .select('nickname, groups(name)')
      .eq('group_id', feedback.group_id)
      .eq('user_id', user!.id)
      .maybeSingle();
    nickname = m?.nickname ?? null;
    groupName = (m as any)?.groups?.name ?? null;
  } else {
    const { data: m } = await supabase
      .from('memberships')
      .select('nickname')
      .eq('user_id', user!.id)
      .neq('status', 'removed')
      .limit(1)
      .maybeSingle();
    nickname = m?.nickname ?? null;
  }

  await postToSlack({
    message: feedback.message,
    category: feedback.category,
    wantsFollowup: feedback.wants_followup,
    nickname,
    email: user?.email ?? null,
    groupId: feedback.group_id,
    groupName,
  });
  return { data: null };
}
