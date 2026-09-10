import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { Card } from '@/components/ui/Card';
import { BackButton } from '@/components/ui/BackButton';
import { CONTACT_EMAIL } from '@/lib/appOrigin';

// The one copy of the terms, not a mirror of a separate marketing-site copy. See
// app/privacy/page.tsx for why: mybarbets.com links here instead of hosting its own text.
//
// Full legal text, not a paraphrase, since 2026-08-27. A content change here has to be paired
// with a lib/legal.ts CURRENT_POLICY_VERSION bump so signed-in users are asked to re-agree.

type Block = { p: string; lead?: string } | { ul: string[] };
type Section = { title: string; blocks: Block[] };

const sections: Section[] = [
  {
    title: '1. What Barbets is (and is not)',
    blocks: [
      { p: 'Barbets is a play-money prediction market for private friend groups. Members of a group create questions ("markets"), place bets using virtual tokens, and settle up through a group vote once the outcome is known.' },
      { p: "Some markets are different: in Barbets' Sports and Weather public groups, markets are created and resolved automatically from public sports and weather data instead of by a group vote. Everything else in these Terms about betting, tokens, and resolution applies to those markets the same way." },
      { p: 'Barbets is not gambling and is not a financial product. Specifically:' },
      {
        ul: [
          'Tokens are virtual play money with no cash or monetary value.',
          'Tokens cannot be purchased, sold, transferred outside the Service, exchanged, or withdrawn for money or anything of value.',
          'No real money, prizes, or things of value are ever wagered, won, or lost through the Service.',
          'Token balances are bookkeeping inside your group’s game, not property. You have no ownership interest in tokens, balances, or any other virtual item in the Service.',
          'Tokens are granted by the Service for free (for example, when you join a group or a new season starts). There are no purchases of any kind in the Service. Nothing costs money, there is nothing to buy, and running out of tokens never costs money (or anything else of value) to fix.',
        ],
      },
      { p: 'You agree not to use the Service to conduct or facilitate real-money gambling in any form, including private side agreements that treat tokens, bets, or outcomes in the Service as redeemable for money or anything of value. Doing so violates these Terms and may violate the law. You are responsible for making sure your use of the Service is lawful where you live, and you may not use the Service where doing so is prohibited.' },
    ],
  },
  {
    title: '2. Eligibility',
    blocks: [
      { p: 'To use the Service you must:' },
      {
        ul: [
          'be at least 18 years old, or the age of majority in your jurisdiction if that is higher; and',
          'not have been previously banned from the Service.',
        ],
      },
      { p: 'The Service is not directed at, and is not intended for use by, anyone under 18. If we learn that an account belongs to someone under 18, we may suspend or delete it.' },
    ],
  },
  {
    title: '3. Your account',
    blocks: [
      { p: `You need an account (email address and password) to use the Service. You are responsible for keeping your credentials confidential and for all activity under your account. Your account is for you personally; do not share it or let others use it. Notify us at ${CONTACT_EMAIL} if you believe your account has been compromised.` },
      { p: 'You can change your email or password, and permanently delete your account, at any time from the Profile page in the app.' },
    ],
  },
  {
    title: '4. Groups, invites, group owners, and moderators',
    blocks: [
      { p: 'Most groups on Barbets are private and joined by invite code. Barbets also runs certain public groups (for example, campus groups, and the Sports and Weather groups described in Section 1) that anyone can join from a directory, without an invite code.' },
      { p: "Group owners run their groups. A group's owner can configure its settings, remove any member at any time for any reason, void markets, and rotate the group's invite code so a removed member cannot rejoin. If someone in your group is behaving badly, the group owner is the fastest line of moderation." },
      { p: "Public groups may also have one or more moderators, assigned by Barbets. A moderator has the same day-to-day authority as an owner over that group: they can create and void markets, remove members, and message the group. Moderators do not have an owner's ability to delete the group or change who owns it." },
      { p: "Invite codes are for people the group intends to invite. Do not attempt to guess, brute-force, or systematically test invite codes, and do not post a private group's invite code publicly without the owner's consent. The Service rate-limits invite-code attempts, and attempting to evade those limits violates these Terms." },
      { p: "Leaving or being removed from a group is handled by the Service's standard rules (for example, your open bets may be refunded or affected markets voided). Group history, such as resolved markets you participated in, may remain visible to the group as part of its record." },
    ],
  },
  {
    title: '5. Hidden markets: a market can be about you',
    blocks: [
      { p: 'A defining feature of Barbets is that a market can be about a group member (the market\'s "subject"). This does not apply to public groups, which do not support markets about a specific person.' },
      { p: "If you're a subject, you are notified that a market about you exists, and you can see a limited summary of it, its status, type, closing time, how many bets have been placed, and, for yes/no and over/under markets, the current odds split. You cannot see its title, description, who created it, or who else is involved, and for multiple-choice markets you cannot see any of the option text, since that could reveal what's actually being asked. The full market becomes visible to you, like any other market, once it resolves or is voided." },
      { p: 'By joining a group, you acknowledge and accept that other members of that group may create markets about you that stay partially hidden from you in this way until they resolve. You agree not to attempt to circumvent this or any other privacy or visibility mechanism of the Service, including by technical means, by using another member’s account, or by probing the Service’s interfaces.' },
      { p: 'Markets about people must still comply with the content rules in Section 6. Being the subject of a market is never an excuse for content that harasses or demeans you. If you are not comfortable with hidden markets, do not join a group, and you can leave any group at any time.' },
    ],
  },
  {
    title: '6. Content rules',
    blocks: [
      { p: '"Content" means anything you submit to the Service: market titles and descriptions, options, nicknames, group names, resolution justifications and clarifications, photos (including profile pictures and resolution proof photos), feedback, and anything else you post.' },
      { p: 'You agree not to post or transmit Content that:' },
      {
        ul: [
          'harasses, threatens, bullies, or demeans any person, including a market subject;',
          'is hateful or discriminatory on the basis of race, ethnicity, religion, sex, gender identity, sexual orientation, disability, or any other protected characteristic;',
          'is sexually explicit, or sexualizes any person without their consent;',
          "exposes another person's private information (doxxing) or intimate images;",
          "is illegal, promotes illegal activity, or infringes anyone's intellectual property or other rights;",
          'impersonates any person or misrepresents your affiliation with anyone; or',
          'contains malware or is designed to disrupt the Service.',
        ],
      },
      { p: 'Take particular care with real people. A market is a question or a prediction, never a place to assert damaging "facts" about someone, do not use a market title, option, description, or resolution justification to state or imply false factual claims about a real person. And while every subject of a market has, by joining the group, agreed to these Terms, people outside your group have not: do not use the Service to defame, harass, or expose the private life of someone who is not a member of the group.' },
      { p: 'Keep markets in the spirit of the product: bets among friends, made in good humor, about people who chose to be in the group with you.' },
    ],
  },
  {
    title: '7. Your Content: ownership, license, and responsibility',
    blocks: [
      { p: 'You retain ownership of your Content. So that we can operate the Service, you grant Barbets a non-exclusive, worldwide, royalty-free license to host, store, reproduce, display, and transmit your Content as needed to provide the Service (for example, showing your markets and bets to your group, delivering push notifications that reference them, and generating shareable images you choose to export).' },
      { p: 'You are solely responsible for your Content and for making sure you have the right to post it. We do not pre-screen Content, and we are not responsible for Content posted by users. We may remove any Content, or restrict, suspend, or terminate any account or group, that we reasonably believe violates these Terms or the law, with or without notice.' },
      { p: 'If you send us feedback, ideas, or suggestions about the Service, you agree we may use them without restriction or compensation to you.' },
    ],
  },
  {
    title: '8. Acceptable use of the Service',
    blocks: [
      { p: 'In addition to the content rules above, you agree not to:' },
      {
        ul: [
          'access the Service by any automated means (bots, scrapers) or use it to build a competing dataset or service;',
          'probe, scan, or test the vulnerability of the Service, or breach or circumvent any security, authentication, rate-limiting, or visibility measure;',
          'interfere with the operation of the Service or impose an unreasonable load on it;',
          'reverse engineer, decompile, or disassemble any part of the Service except where such restriction is prohibited by law; or',
          'use the Service for any commercial purpose (advertising, promotion, solicitation) without our prior written consent.',
        ],
      },
    ],
  },
  {
    title: '9. Reporting problems and enforcement',
    blocks: [
      { p: `To report abusive content or behavior, email ${CONTACT_EMAIL}. We review every report and may, in response to a report or on our own initiative, remove Content, void markets, suspend or delete groups, or suspend or terminate accounts.` },
      { p: 'We may also suspend or terminate your access to the Service if you breach these Terms, if required by law, or if we discontinue the Service. Where practical, we will give you notice, but we may act without notice where the violation is serious or notice is impractical.' },
    ],
  },
  {
    title: '10. Tokens, bugs, and game integrity',
    blocks: [
      { p: 'The token economy exists to keep the game fair inside each group. We may adjust, correct, or reset token balances, markets, payouts, or other game state to fix bugs, reverse the effects of cheating or abuse, or maintain the integrity of the Service. Because tokens have no monetary value, such adjustments do not entitle anyone to compensation.' },
    ],
  },
  {
    title: '11. The apps and app stores',
    blocks: [
      { p: 'The Service is available as a web app and as mobile apps distributed through app stores such as Google Play and the Apple App Store. Your use of an app obtained through a store is also subject to that store’s terms.' },
      { p: 'If you use the iOS app: these Terms are between you and Barbets, not Apple; Apple has no obligation to provide maintenance or support for the app; and Apple is a third-party beneficiary of these Terms with the right to enforce them against you. In the event of any failure of the app to conform to an applicable warranty, you may notify Apple and Apple may refund the purchase price (if any); to the maximum extent permitted by law, Apple has no other warranty obligation with respect to the app.' },
    ],
  },
  {
    title: '12. Intellectual property',
    blocks: [
      { p: 'The Service, including its software, design, logos, icons, and text other than user Content, is owned by Barbets or its licensors and is protected by intellectual property laws. We grant you a limited, personal, non-exclusive, non-transferable, revocable license to use the Service as intended by these Terms. We reserve all rights not expressly granted.' },
      { lead: 'Reporting infringement.', p: `If you believe Content on the Service infringes your copyright or other intellectual property rights, email ${CONTACT_EMAIL} with: (a) identification of the protected work; (b) where the allegedly infringing Content appears; (c) your contact information; (d) a statement that you have a good-faith belief the use is not authorized by the rights holder, their agent, or the law; and (e) a statement, under penalty of perjury, that your notice is accurate and that you are the rights holder or authorized to act for them. We may remove Content in response to a valid notice, and we terminate the accounts of repeat infringers where appropriate.` },
    ],
  },
  {
    title: '13. Termination and account deletion',
    blocks: [
      { p: 'You may stop using the Service at any time, and you may permanently delete your account from the Profile page in the app. Deleting your account removes your account and personal data as described in our Privacy Policy; markets and group records you participated in are handled the same way they are when any member leaves a group.' },
      { p: 'Sections of these Terms that by their nature should survive termination (including Sections 1, 7, 12, and 14–17) survive.' },
    ],
  },
  {
    title: '14. Disclaimers',
    blocks: [
      { p: 'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR AVAILABLE AT ANY PARTICULAR TIME, OR THAT ANY DATA (INCLUDING TOKEN BALANCES AND GROUP HISTORY) WILL BE PRESERVED. THE SERVICE IS A GAME PLAYED WITH VIRTUAL TOKENS; NOTHING IN THE SERVICE IS FINANCIAL, LEGAL, OR ANY OTHER KIND OF PROFESSIONAL ADVICE.' },
      { p: 'Some jurisdictions do not allow the exclusion of certain warranties, so some of the above may not apply to you.' },
    ],
  },
  {
    title: '15. Limitation of liability',
    blocks: [
      { p: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, BARBETS AND ITS OFFICERS, EMPLOYEES, AND AGENTS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, GOODWILL, OR PROFITS, ARISING OUT OF OR RELATING TO YOUR USE OF (OR INABILITY TO USE) THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM AROSE (WHICH, FOR A FREE SERVICE, MAY BE ZERO) AND (B) FIFTY U.S. DOLLARS (US $50).' },
      { p: 'Some jurisdictions do not allow the limitation of certain damages, so some of the above may not apply to you. Nothing in these Terms limits liability for fraud, gross negligence, or willful misconduct, or any other liability that cannot be excluded or limited by law.' },
    ],
  },
  {
    title: '16. Indemnification',
    blocks: [
      { p: "You agree to indemnify and hold harmless Barbets from any third-party claims, damages, liabilities, and expenses (including reasonable attorneys' fees) to the extent arising out of your Content, your misuse of the Service, or your violation of these Terms or of any law or third-party right. This obligation does not apply to the extent a claim results from our own gross negligence, willful misconduct, or violation of law. We will promptly notify you of any claim subject to this section and may, at our option, assume control of its defense, in which case you will cooperate with us." },
    ],
  },
  {
    title: '17. Governing law and dispute resolution',
    blocks: [
      { p: 'These Terms are governed by the laws of New Jersey, United States of America, without regard to conflict-of-laws principles.' },
      { lead: 'Talk to us first.', p: `Before filing any formal claim against Barbets, you agree to email ${CONTACT_EMAIL} a written description of the dispute and what you want, and to give us 60 days to try to resolve it with you informally. Most problems are fixed faster this way than through any formal process.` },
      { lead: 'Arbitration.', p: 'If we cannot resolve a dispute informally, you and Barbets agree that any dispute arising out of or relating to these Terms or the Service will be resolved by binding arbitration on an individual basis, administered by the American Arbitration Association under its Consumer Arbitration Rules, rather than in court, except that (a) either party may bring an individual claim in small-claims court, and (b) either party may seek injunctive or other equitable relief in court for infringement or misuse of intellectual property or for unauthorized access to the Service. Judgment on an arbitration award may be entered in any court with jurisdiction.' },
      { lead: 'Class-action and jury waiver.', p: 'Disputes will be resolved only on an individual basis. TO THE EXTENT PERMITTED BY LAW, NEITHER YOU NOR BARBETS MAY PARTICIPATE IN A CLASS, CONSOLIDATED, OR REPRESENTATIVE ACTION OR ARBITRATION AGAINST THE OTHER, AND EACH PARTY WAIVES ANY RIGHT TO A JURY TRIAL. If the class-action waiver is found unenforceable as to a particular claim, that claim (and only that claim) must proceed in court, and this section continues to apply to all other claims.' },
      { lead: 'Your right to opt out.', p: `You may reject this arbitration agreement and class-action waiver, with no effect on any other part of these Terms or on your use of the Service, by emailing ${CONTACT_EMAIL} with the subject line "Arbitration opt-out" within 30 days of first accepting these Terms.` },
      { p: 'If arbitration does not apply to a dispute (because you opted out, the dispute is carved out above, or arbitration is unenforceable where you live), that dispute will be resolved in the courts located in New Jersey, and both parties consent to their jurisdiction. Nothing in this section limits any non-waivable rights you have under the consumer-protection laws of your place of residence.' },
    ],
  },
  {
    title: '18. Changes to the Service and to these Terms',
    blocks: [
      { p: 'We are always improving the Service and may change, suspend, or discontinue any part of it at any time. We may also update these Terms. If a change to these Terms is material, we will give you advance notice (for example, an in-app notice or an email) at least 14 days before it takes effect, and the "Last updated" date on this page will always reflect the current version. Changes are not retroactive: the version in effect when a dispute arose governs that dispute, and a change to Section 17 does not apply to disputes that arose before the change took effect. Your continued use of the Service after a change takes effect means you accept the updated Terms. If you do not agree, stop using the Service and delete your account before the change takes effect.' },
    ],
  },
  {
    title: '19. General',
    blocks: [
      { p: 'These Terms, together with the Privacy Policy, are the entire agreement between you and Barbets about the Service. If any provision of these Terms is found unenforceable, the rest remain in effect. Our failure to enforce a provision is not a waiver of it. You may not assign these Terms; we may assign them in connection with a merger, acquisition, or sale of assets. There are no third-party beneficiaries of these Terms except as stated in Section 11.' },
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

export default async function TermsPage() {
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
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Terms of use</h1>
        <p className="mt-1 text-espresso-500">Last updated: August 28, 2026</p>
        <p className="mt-3 text-espresso-600">
          These Terms of Service ("Terms") are an agreement between you and My Barbets LLC, doing business as Barbets
          ("Barbets," "we," "us," or "our") governing your use of the Barbets application and websites, including
          app.mybarbets.com, mybarbets.com, and the Barbets mobile apps (together, the "Service"). You accept these
          Terms by checking the acceptance box when you create an account, and in any event by using the Service. If
          you do not agree, do not use the Service.
        </p>
      </div>

      <div className="space-y-4">
        {sections.map((s) => (
          <Card key={s.title}>
            <h2 className="font-display font-bold text-espresso-800">{s.title}</h2>
            {s.blocks.map(renderBlock)}
          </Card>
        ))}
      </div>

      <p className="text-sm text-espresso-500">
        Questions about these terms? Reach out at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-espresso-700 underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </main>
  );
}
