'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteMarketTemplate } from '@/lib/actions/marketTemplates';
import { MARKET_TEMPLATE_CATEGORIES, categoryLabel } from '@/lib/marketTemplateCategories';
import type { MarketType } from '@/lib/marketType';
import { ScreenHeader, StickyFooter, FooterButton, RowChevron } from '@/components/ui/Screen';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { Modal } from '@/components/ui/Modal';
import type { MarketTemplate } from '@/lib/marketTemplates';
import type { MemberOption } from '@/components/markets/MarketForms';
import { cn } from '@/lib/cn';

const eyebrowClasses = 'text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase';
const cardClasses = 'relative rounded-[18px] border border-hairline bg-surface px-3.5 py-3 text-left';
const emptyStateClasses = 'rounded-[18px] border border-dashed border-dash p-3.5 text-[12.5px] leading-[1.45] text-faint';

/** The same three glyphs the + menu (4p) and the propose form (4i) draw for each question type. */
const TYPE_GLYPH: Record<MarketType, React.ReactNode> = {
  yes_no: <path d="M5 8h6M5 16h6M15 6l3 3 3-6" />,
  multiple_choice: (
    <>
      <circle cx="6" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <path d="M11 7h8M11 17h8" />
    </>
  ),
  over_under: <path d="M4 18h16M7 18V9M12 18V5M17 18v-6" />,
};

function kindLine(t: MarketTemplate): string {
  if (t.market_type === 'yes_no') return 'Yes / No';
  if (t.market_type === 'over_under') return 'Over / Under';
  const n = (t as { options?: string[] | null }).options?.length ?? 0;
  return n > 0 ? `One of ${n} options` : 'Pick a winner';
}

/** A section that always renders (so "you have none" is a real, legible state rather than the
 * section just vanishing), showing its cards or a dashed empty-state card in its place. */
function TemplateSection({ label, emptyMessage, children }: { label: string; emptyMessage: string; children: React.ReactNode[] }) {
  return (
    <section>
      <p className={cn(eyebrowClasses, 'mb-[9px]')}>{label}</p>
      {children.length > 0 ? <div className="flex flex-col gap-2">{children}</div> : <p className={emptyStateClasses}>{emptyMessage}</p>}
    </section>
  );
}

function TemplateCard({
  template,
  deletable,
  onTap,
  onDelete,
}: {
  template: MarketTemplate;
  deletable: boolean;
  onTap: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={cardClasses}>
      <button type="button" onClick={onTap} className="flex w-full items-center gap-3 border-0 bg-transparent p-0 text-left">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-tile text-muted">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {TYPE_GLYPH[template.market_type]}
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-[1.35] font-bold text-ink">
            {template.has_placeholder ? <PlaceholderTitle title={template.title} /> : template.title}
          </span>
          <span className="mt-[5px] flex items-center gap-[7px]">
            {template.has_placeholder && (
              <span className="rounded-full border border-signal-edge bg-signal-tint px-2 py-0.5 text-[10px] font-bold text-signal">Fill in @</span>
            )}
            <span className="text-[11px] text-faint">{kindLine(template)}</span>
          </span>
        </span>
        {!deletable && <RowChevron className="text-faint" />}
      </button>
      {deletable && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete template"
          className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full border-0 bg-transparent text-base text-faint hover:bg-rule hover:text-alert"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** `@` renders as an italic honey mention consistent with Mention everywhere else it appears, but
 * the "@" glyph itself is the point here (not a real nickname), so it's inlined rather than
 * reusing <Mention nickname="…"> which always prints a leading "@" plus a name. */
function PlaceholderTitle({ title }: { title: string }) {
  const parts = title.split('@');
  return (
    <>
      {parts.map((chunk, i) => (
        <span key={i}>
          {chunk}
          {i < parts.length - 1 && <span className="text-signal">@</span>}
        </span>
      ))}
    </>
  );
}

function MemberPickerModal({
  template,
  members,
  onClose,
  onPick,
}: {
  template: MarketTemplate;
  members: MemberOption[];
  onClose: () => void;
  onPick: (member: MemberOption) => void;
}) {
  return (
    <Modal onClose={onClose} padded={false} panelClassName="overflow-hidden">
      <div className="bg-rule px-[18px] py-[13px]">
        <p className="text-[13px] font-extrabold text-ink">Who&apos;s this about?</p>
        <p className="mt-1 text-[12.5px] text-muted">
          <PlaceholderTitle title={template.title} />
        </p>
      </div>
      <div className="flex flex-wrap gap-2 p-[18px]">
        {members.map((m) => (
          <button
            key={m.userId}
            type="button"
            onClick={() => onPick(m)}
            className="rounded-full border-[1.5px] border-hairline px-[15px] py-2 text-[13px] font-bold text-ink"
          >
            @{m.nickname}
          </button>
        ))}
        {members.length === 0 && <p className="text-sm text-faint">No one else to pick from yet.</p>}
      </div>
      <div className="border-t border-rule px-[18px] py-[14px]">
        <button type="button" onClick={onClose} className="w-full rounded-[14px] border border-hairline py-3 text-sm font-bold text-ink">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** A curated category section, collapsed/expanded independently of every other one. Defaults
 * closed, so the gallery opens as a short, scannable list of category names rather than every
 * idea in every category at once. */
function CollapsibleCategory({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={open ? 'py-1' : 'border-b border-rule'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn('flex w-full items-center justify-between gap-2.5 border-0 bg-transparent p-0', open ? 'pt-1' : 'py-3.5')}
      >
        <span className={eyebrowClasses}>{label}</span>
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={cn('text-faint transition-transform', open && 'rotate-180')}>
          <path d="M1.5 2.5 6 6.5l4.5-4" />
        </svg>
      </button>
      {open && <div className="mt-2.5 mb-[18px] flex flex-col gap-2">{children}</div>}
    </section>
  );
}

export function TemplateGallery({
  groupId,
  groupName,
  isPublic,
  members,
  templates,
  viewerId,
  groupAvatarKey,
}: {
  groupId: string;
  groupName: string;
  groupAvatarKey?: string | null;
  isPublic: boolean;
  members: MemberOption[];
  templates: MarketTemplate[];
  viewerId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(templates);
  const [picking, setPicking] = useState<MarketTemplate | null>(null);
  const [, startTransition] = useTransition();

  // Public groups can never carry a subject at all (create_market() rejects it outright), so a
  // placeholder template there could only ever land un-personalized — simpler to not offer it.
  const visible = useMemo(() => (isPublic ? rows.filter((t) => !t.has_placeholder) : rows), [isPublic, rows]);

  const mine = visible.filter((t) => t.scope === 'private');
  const shared = visible.filter((t) => t.scope === 'group');
  const curated = visible.filter((t) => t.scope === 'curated');

  function openTemplate(template: MarketTemplate, memberId?: string) {
    const params = new URLSearchParams({ templateId: template.id });
    if (memberId) params.set('memberId', memberId);
    router.push(`/groups/${groupId}/markets/new?${params.toString()}`);
  }

  function tap(template: MarketTemplate) {
    if (template.has_placeholder) {
      setPicking(template);
    } else {
      openTemplate(template);
    }
  }

  function remove(id: string) {
    setRows((prev) => prev.filter((t) => t.id !== id));
    startTransition(async () => {
      const result = await deleteMarketTemplate(groupId, id);
      if (result.error) {
        // Rare (someone else deleted it first, or a network blip) — restore it rather than
        // silently losing it from the list with no explanation.
        setRows(templates);
      }
    });
  }

  return (
    <div className="-mx-[18px] -mt-6">
      <ScreenHeader
        title="Templates"
        href={`/groups/${groupId}`}
        right={
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-muted">
            <GroupAvatar name={groupName} avatarKey={groupAvatarKey ?? null} className="h-5 w-5 text-[8px]" fallbackClassName="bg-ink text-on-ink" />
            {groupName.split(/\s+/)[0]}
          </span>
        }
      />
    <div className="flex flex-col gap-5 px-[18px] pt-5">
      <div>
        <h1 className="text-[25px] leading-[1.15] font-extrabold tracking-[-0.022em] text-ink">Start from an idea</h1>
        <p className="mt-1.5 text-[13px] leading-[1.45] text-faint">Pick one to prefill, or build a market from scratch.</p>
      </div>

      <TemplateSection label="Your templates" emptyMessage="Nothing saved yet. Save a market as a template from its review step to see it here.">
        {mine.map((t) => (
          <TemplateCard key={t.id} template={t} deletable={t.created_by === viewerId} onTap={() => tap(t)} onDelete={() => remove(t.id)} />
        ))}
      </TemplateSection>

      <TemplateSection label="Shared in this group" emptyMessage="No one has shared a template with this group yet.">
        {shared.map((t) => (
          <TemplateCard key={t.id} template={t} deletable={t.created_by === viewerId} onTap={() => tap(t)} onDelete={() => remove(t.id)} />
        ))}
      </TemplateSection>

      <div>
      {MARKET_TEMPLATE_CATEGORIES.filter(({ slug }) => curated.some((t) => t.category === slug)).map(({ slug }, i) => {
        const inCategory = curated.filter((t) => t.category === slug);
        return (
          <CollapsibleCategory key={slug} label={categoryLabel(slug)} defaultOpen={i === 0}>
            {inCategory.map((t) => (
              <TemplateCard key={t.id} template={t} deletable={false} onTap={() => tap(t)} />
            ))}
          </CollapsibleCategory>
        );
      })}

      {(() => {
        const known = new Set(MARKET_TEMPLATE_CATEGORIES.map((c) => c.slug as string));
        const other = curated.filter((t) => !known.has(t.category ?? ''));
        if (other.length === 0) return null;
        return (
          <CollapsibleCategory label="Other">
            {other.map((t) => (
              <TemplateCard key={t.id} template={t} deletable={false} onTap={() => tap(t)} />
            ))}
          </CollapsibleCategory>
        );
      })()}

      </div>
    </div>

      <StickyFooter>
        <FooterButton tone="ink" href={`/groups/${groupId}/markets/new`}>
          Build from scratch
        </FooterButton>
      </StickyFooter>

      {picking && (
        <MemberPickerModal
          template={picking}
          members={members}
          onClose={() => setPicking(null)}
          onPick={(member) => openTemplate(picking, member.userId)}
        />
      )}
    </div>
  );
}
