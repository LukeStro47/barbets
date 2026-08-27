import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { Card } from '@/components/ui/Card';
import { BackButton } from '@/components/ui/BackButton';
import { CONTACT_EMAIL } from '@/lib/appOrigin';

// This page is a mirror of the canonical policy at mybarbets.com/privacy, which is the URL given
// to App Store Connect and Google Play. It exists in the app as well because the signup flow's
// terms checkbox and the profile small-print tiles link here, and inside the Capacitor WebView an
// external link punts the user out to the system browser mid-signup. Change both together.
//
// Full legal text, not a paraphrase, since 2026-08-27. A content change here has to be paired
// with a lib/legal.ts CURRENT_POLICY_VERSION bump so signed-in users are asked to re-agree.

type Block = { p: string; lead?: string } | { ul: string[] };
type Section = { title: string; blocks: Block[] };

const policySections: Section[] = [
  {
    title: 'Information you give us',
    blocks: [
      { lead: 'Account information.', p: 'Your email address and a password. Passwords are stored only in hashed form by our authentication provider; we do not store plaintext passwords.' },
      { lead: 'Profile information.', p: 'A nickname for each group you join (your identity in Barbets is per-group), and optionally a profile picture, either a photo you upload or a preset icon you pick. If you upload a photo, you can crop it in the app before it is saved.' },
      { lead: 'Game activity.', p: 'The groups you belong to, markets you create or endorse, bets you place, votes you cast, resolution proposals and challenges, clarification requests, reactions, and the resulting token balances and ledger history. This is the substance of the game and is functional data, not marketing data.' },
      { lead: 'Photos you attach to resolutions.', p: "When proposing a market's outcome you can attach a proof photo. These are compressed on your device before upload and stored in a private storage bucket; they are only viewable by group members allowed to see that market." },
      { lead: 'Feedback.', p: 'Anything you submit through the in-app feedback form or send to us by email.' },
    ],
  },
  {
    title: 'Information collected automatically',
    blocks: [
      { lead: 'Push notification tokens.', p: 'If you turn on notifications, we store a device token (a web push subscription for the browser/PWA, or a Firebase Cloud Messaging token for the native app) so we can deliver them. Dead tokens are removed automatically.' },
      { lead: 'IP addresses for rate limiting.', p: 'To stop people from guessing group invite codes, we count failed attempts, per account when you are signed in, and by IP address for the one check available before sign-in. These counters exist solely for abuse prevention.' },
      { lead: 'Error and diagnostic data.', p: 'If something in the app breaks, an error report (the error message, stack trace, and the route or action it happened on) is posted to a private channel we operate so we can fix it. These reports are technical in nature and are not used for profiling.' },
      { lead: 'Product usage and lifecycle events.', p: 'To understand how Barbets is used and to keep it running well, we record certain lifecycle events tied to your account, for example, signing up, joining or creating a group, starting or ending a season, creating a market, and placing a bet. We use these, together with existing records like your groups, markets, and bets, to calculate internal metrics such as how many people are actively using the Service and how well we retain them over time. This data lives in our own database and is visible only to Barbets staff through an internal admin dashboard, it is never sent to, or processed by, any third-party analytics or advertising company.' },
      { lead: 'Install attribution from printed QR codes and NFC tags.', p: 'If you install the Android app by scanning one of our printed QR codes or an NFC tag, the Play Store passes the app a campaign tag identifying the print batch or tag location (for example, "card" or a specific campus). We also log the platform (Android, iOS, or other) and a coarse, non-precise location (country and region, inferred from IP address) for each scan, so we can tell which physical print batch or location led to installs. This happens before you have an account, is not linked to you personally, and involves no third-party analytics service.' },
      { lead: 'Cookies and local storage.', p: 'We use cookies only to keep you signed in (authentication session cookies) and for basic operation of the Service (for example, a beta-access cookie while the beta gate is on). The app also uses your device’s local storage for small preferences, such as remembering that you have already seen the onboarding tour. We use no advertising or cross-site tracking cookies.' },
      { lead: 'Server logs.', p: 'Like nearly every online service, our hosting providers keep standard server logs (such as IP address, request URL, and timestamp) for security and operations.' },
    ],
  },
  {
    title: 'What we deliberately do not collect',
    blocks: [
      { p: 'No advertising identifiers, no third-party analytics or tracking SDKs, no contact-list access, and no payment or financial information. The only location signal we ever infer is the coarse, country/region-level estimate described above for QR/NFC scan attribution, and it is never tied to an account. Camera and photo access is used only when you choose to take or attach a picture.' },
    ],
  },
];

const usageSections: Section[] = [
  {
    title: 'How we use your information',
    blocks: [
      { p: 'We use the information above to:' },
      {
        ul: [
          "provide the Service: run your groups, markets, bets, and payouts, and show you and your group the game's state",
          'deliver push notifications you have opted into (you can turn them off, per category and per group, at any time from your Profile)',
          'keep the Service secure: authenticate you, rate-limit invite-code guessing, and prevent abuse',
          'fix problems, using error reports and diagnostics',
          'understand and improve the Service using internal usage and growth metrics (for example, active users and retention)',
          'respond when you contact us or send feedback; and',
          'understand, at a print-batch level, whether our printed QR materials and NFC tags work.',
        ],
      },
      { p: 'We do not use your information for advertising, we do not sell or rent it to anyone, and we do not share it with any outside analytics or advertising company.' },
      { p: 'Where laws such as the EU/UK GDPR apply, our legal bases for this processing are: performance of our contract with you (running the Service and your groups), our legitimate interests (securing the Service, preventing abuse, fixing bugs, and understanding usage of the Service so we can improve it), and your consent (push notifications), which you can withdraw at any time.' },
    ],
  },
  {
    title: 'What other users can see',
    blocks: [
      { p: 'Barbets is a social game, so your activity is visible to the other members of your groups by design:' },
      { p: 'Members of a group can see your nickname in that group, your profile picture, your token balance, your bets, and your place on the leaderboard and in group records. Your email address is never shown to other users.' },
      { lead: 'Hidden markets.', p: 'A market can be about a group member (its "subject"). The subject cannot see the market exists until it resolves or is voided; every other eligible member of the group can. Once it resolves, it becomes visible to the subject like any other market, including who bet what.' },
      { p: 'Profile pictures are served from a public storage location so the app can display them quickly wherever your nickname appears. In practice this means an uploaded profile photo is accessible to anyone who has its direct URL, so do not upload a photo you would not want visible outside your group.' },
      { p: 'Resolution proof photos are private and only viewable, through the app, by members allowed to see the market they belong to.' },
      { lead: 'Share images.', p: 'The app can generate shareable images (for example, a market reveal ticket or your record card). These are created on your device and shared only when you choose to share them; once you share one outside the app, it is outside our control.' },
      { p: "Beyond your groups, nothing about your activity is public. Someone with a group's invite link sees only the group's name, logo, and an invitation to join. Never member lists, balances, or markets." },
    ],
  },
  {
    title: 'Who we share information with',
    blocks: [
      { p: 'We share information only with the service providers that run Barbets on our behalf ("processors"), and only for that purpose:' },
      {
        ul: [
          'Supabase, hosts our database, authentication, and file storage.',
          'Vercel, hosts the web application.',
          'Google (Firebase Cloud Messaging), delivers push notifications to the native mobile app.',
          "Your browser's push service (operated by e.g. Google, Apple, or Mozilla), delivers web push notifications to your browser or installed PWA.",
          'Slack, receives our internal error reports and feedback-form submissions in a private channel we control.',
        ],
      },
      { p: 'None of these providers may use your data for anything beyond providing their service to us.' },
      { p: 'Beyond processors, we disclose information only if required by law (for example, a valid legal request), to protect the rights, safety, or property of Barbets or others, or in connection with a merger, acquisition, or sale of assets (in which case this policy continues to apply to your data until you are told otherwise). We never sell your personal information, and we do not share it with anyone for advertising.' },
    ],
  },
  {
    title: 'Data retention',
    blocks: [
      { p: 'We keep your information for as long as your account exists, because it is the live state of your groups and games. Some internal data is shorter-lived, for example, processed notification events are purged after 30 days.' },
      { p: 'When you delete your account, your account and personal data are deleted, and your historical game activity is disassociated from you (for example, a market you created simply stops showing a creator). Data held by our processors is deleted according to their standard schedules, and residual copies in backups roll off as backups expire.' },
    ],
  },
  {
    title: 'Your choices and rights',
    blocks: [
      { lead: 'Access and correction.', p: 'You can see and change your email, password, nicknames, and profile picture in the app at any time.' },
      { lead: 'Notifications.', p: 'Push notifications are off until you enable them, and you can disable them, entirely, per category, or per group, from your Profile at any time.' },
      { lead: 'Deletion.', p: 'You can permanently delete your account yourself from Profile, Account, without emailing anyone or waiting. If in-app deletion ever fails, email us and we will complete it for you.' },
      { lead: 'Everything else.', p: `Depending on where you live (for example, the EU/EEA, UK, or California), you may have legal rights over your personal data, such as the right to access, correct, delete, or export it, or to object to certain processing. Wherever you live, you can email us at ${CONTACT_EMAIL} and we will respond to reasonable requests consistent with applicable law. You also have the right to complain to your local data-protection authority.` },
      { p: 'We do not "sell" or "share" personal information as those terms are defined under the California Consumer Privacy Act, and we have no financial incentive programs tied to your data. We do not discriminate against anyone for exercising a privacy right.' },
    ],
  },
  {
    title: 'Security',
    blocks: [
      { p: "All traffic to the Service is encrypted in transit (HTTPS). Access to data in our database is deny-by-default: every read is filtered by row-level security rules, every write goes through controlled server-side functions, and the app's privacy model (including hidden markets) is enforced in the database itself, not just in the interface. Proof photos live in a private bucket accessible only through short-lived signed links issued after a visibility check. No system is perfectly secure, but we designed Barbets so that the sensitive paths are few and centrally checked." },
      { p: 'If we learn of a breach affecting your personal data, we will notify you and the relevant authorities as required by law.' },
    ],
  },
  {
    title: 'Children',
    blocks: [
      { p: `Barbets is not directed at anyone under 18. You must be at least 18 years old (or the age of majority where you live, if that is higher) to use the Service, and we do not knowingly collect personal information from anyone younger. If you believe someone under 18 has created an account, email us at ${CONTACT_EMAIL} and we will delete it.` },
    ],
  },
  {
    title: 'International users',
    blocks: [
      { p: "Barbets is operated from, and your information is stored and processed in, the countries where we and our processors operate, which may be different from where you live and may have different data-protection laws. Where required, we rely on appropriate safeguards (such as our processors' standard contractual clauses) for international transfers." },
    ],
  },
  {
    title: 'Changes to this policy',
    blocks: [
      { p: 'If we change this policy in a way that matters, we will update this page and take reasonable steps to bring the change to your attention (such as an in-app notice). The "Last updated" date at the top always tells you when it last changed. Continued use of the Service after a change takes effect means you accept the updated policy.' },
    ],
  },
];

function renderBlock(block: Block, i: number) {
  if ('ul' in block) {
    return (
      <ul key={i} className="mt-2 list-disc space-y-1 pl-5 text-espresso-600">
        {block.ul.map((item, j) => (
          <li key={j}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <p key={i} className="mt-2 text-espresso-600 first:mt-0">
      {block.lead && <strong className="font-semibold text-espresso-800">{block.lead} </strong>}
      {block.p}
    </p>
  );
}

export default async function PrivacyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-lg space-y-8 px-5 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div className="flex items-center justify-between">
        <BackButton fallbackHref={user ? '/groups' : '/'} />
        <Logo />
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Privacy policy</h1>
        <p className="mt-1 text-espresso-500">Last updated: August 27, 2026</p>
        <p className="mt-3 text-espresso-600">
          This Privacy Policy explains what information My Barbets LLC, doing business as Barbets ("Barbets," "we,"
          "us," or "our") collects when you use the Barbets application and websites, app.mybarbets.com,
          mybarbets.com, and the Barbets mobile apps (together, the "Service"), how we use it, who we share it with,
          and the choices you have.
        </p>
        <p className="mt-2 text-espresso-600">
          The short version: we collect only what the app needs to work. No ads, no advertising trackers, and no
          third-party analytics or tracking SDKs, we never sell your data. We do keep basic internal usage statistics
          (like sign-ups and active users) to run and improve Barbets, but that stays inside Barbets; it is never
          sent to or processed by an outside analytics or advertising company. Barbets is play money only, no payment
          or financial information is ever collected, because there is nothing to pay for.
        </p>
      </div>

      <div>
        <h2 className="font-display text-lg font-bold text-espresso-900">Information we collect</h2>
        <div className="mt-3 space-y-4">
          {policySections.map((s) => (
            <Card key={s.title}>
              <h3 className="font-display font-bold text-espresso-800">{s.title}</h3>
              {s.blocks.map(renderBlock)}
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {usageSections.map((s) => (
          <Card key={s.title}>
            <h2 className="font-display font-bold text-espresso-800">{s.title}</h2>
            {s.blocks.map(renderBlock)}
          </Card>
        ))}
      </div>

      <p className="text-sm text-espresso-500">
        Questions about this policy or your data? Reach out at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-espresso-700 underline">
          {CONTACT_EMAIL}
        </a>
        . See also our{' '}
        <a href="/terms" className="font-medium text-espresso-700 underline">
          Terms of use
        </a>
        .
      </p>
    </main>
  );
}
