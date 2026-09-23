'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteMarketTemplate } from '@/lib/actions/marketTemplates';
import { MARKET_TEMPLATE_CATEGORIES, categoryLabel } from '@/lib/marketTemplateCategories';
import { MARKET_TYPE_LABEL, MARKET_TYPE_ICON } from '@/lib/marketType';
import { Mention } from '@/components/ui/Mention';
import { Modal } from '@/components/ui/Modal';
import { CaretDownIcon, ChevronRightIcon } from '@/components/ui/icons';
import type { MarketTemplate } from '@/lib/marketTemplates';
import type { MemberOption } from '@/components/markets/MarketForms';
import { cn } from '@/lib/cn';

const eyebrowClasses = 'text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase';
const cardClasses = 'relative rounded-[20px] border border-hairline bg-surface p-3.5 text-left';
const emptyStateClasses = 'rounded-[20px] border border-dashed border-hairline p-4 text-[13px] leading-[1.45] text-muted';

/** A section that always renders (so "you have none" is a real, legible state rather than the
 * section just vanishing), showing its cards or a dashed empty-state card in its place. */
function TemplateSection({ label, emptyMessage, children }: { label: string; emptyMessage: string; children: React.ReactNode[] }) {
  return (
    <section>
      <p className={cn(eyebrowClasses, 'mb-2.5')}>{label}</p>
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
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-rule text-base font-semibold text-muted">
          {MARKET_TYPE_ICON[template.market_type]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] leading-[1.35] font-bold text-ink">
            {template.has_placeholder ? <PlaceholderTitle title={template.title} /> : template.title}
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            {template.has_placeholder && (
              <span className="rounded-[8px] bg-signal-tint px-2 py-0.5 text-[11px] font-bold text-signal">Fill in @</span>
            )}
            <span className="text-[11.5px] text-faint">{MARKET_TYPE_LABEL[template.market_type]}</span>
          </span>
        </span>
        {!deletable && <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-faint" />}
      </button>
      {deletable && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete template"
          className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-[10px] border-0 bg-transparent text-base text-faint hover:bg-rule hover:text-alert"
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
          {i < parts.length - 1 && <span className="font-bold text-signal italic">@</span>}
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
      <div className="border-b border-hairline px-[18px] py-[13px]">
        <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Who&apos;s this about?</p>
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
            className="rounded-[999px] border border-hairline bg-surface px-[15px] py-2 text-[13px] font-bold text-muted"
          >
            <Mention nickname={m.nickname} />
          </button>
        ))}
        {members.length === 0 && <p className="text-sm text-muted">No one else to pick from yet.</p>}
      </div>
      <div className="border-t border-hairline px-[18px] py-[14px]">
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
function CollapsibleCategory({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 border-0 bg-transparent p-0"
      >
        <span className={eyebrowClasses}>{label}</span>
        <CaretDownIcon className={cn('h-3.5 w-3.5 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="mt-2.5 flex flex-col gap-2">{children}</div>}
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
}: {
  groupId: string;
  groupName: string;
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
    <div className="flex flex-1 flex-col gap-[22px]">
      <div>
        <button
          type="button"
          onClick={() => router.push(`/groups/${groupId}`)}
          className="-ml-1.5 inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-faint"
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="mt-2.5 text-[26px] leading-[1.14] font-extrabold tracking-[-0.02em] text-ink">
          Start from an idea
        </h1>
        <p className="mt-1 text-[13.5px] leading-[1.5] text-muted">
          Pick one to prefill, or build a market from scratch.
        </p>
      </div>

      <TemplateSection label="Your templates" emptyMessage="Nothing saved yet. Save a market as a template from its review step to see it here.">
        {mine.map((t) => (
          <TemplateCard key={t.id} template={t} deletable={t.created_by === viewerId} onTap={() => tap(t)} onDelete={() => remove(t.id)} />
        ))}
      </TemplateSection>

      <TemplateSection label="Shared in this group" emptyMessage="Nobody has shared a template with this group yet.">
        {shared.map((t) => (
          <TemplateCard key={t.id} template={t} deletable={t.created_by === viewerId} onTap={() => tap(t)} onDelete={() => remove(t.id)} />
        ))}
      </TemplateSection>

      {MARKET_TEMPLATE_CATEGORIES.map(({ slug }) => {
        const inCategory = curated.filter((t) => t.category === slug);
        if (inCategory.length === 0) return null;
        return (
          <CollapsibleCategory key={slug} label={categoryLabel(slug)}>
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
