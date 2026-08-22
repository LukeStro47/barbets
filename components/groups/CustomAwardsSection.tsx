'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createCustomGroupTitle, deleteCustomGroupTitle } from '@/lib/actions/customAwards';
import { CUSTOM_AWARD_SHAPES, findShape, type CustomGroupTitle, type CustomGroupTitleHolder } from '@/lib/customAwards';
import { CUSTOM_AWARD_LABEL_MAX_LENGTH, CUSTOM_AWARD_MAX_PER_GROUP } from '@/lib/limits';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Mention } from '@/components/ui/Mention';

const inputClasses =
  'w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-[15px] font-semibold text-espresso-950 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';
const rowClassName = 'flex items-center gap-[11px] rounded-2xl border border-espresso-100 bg-paper-white px-3.5 py-3';

/**
 * The awards page's second section, group-configured rather than app-defined — the "Propose an
 * award / Soon" placeholder this replaces was removed rather than restyled because a disabled row
 * promising a feature costs attention on every visit. Deliberately a separate section from the
 * fixed 8, not merged into AwardsRail/AwardGlyph/UnclaimedTitles: those are tightly typed to the
 * closed TitleKey enum, and a custom award's label/emoji/description are data, not code.
 */
export function CustomAwardsSection({
  groupId,
  isOwner,
  titles,
  holderByTitleId,
  nicknameByUserId,
  membershipIdByUserId,
  currentUserId,
}: {
  groupId: string;
  isOwner: boolean;
  titles: CustomGroupTitle[];
  holderByTitleId: Map<string, CustomGroupTitleHolder>;
  nicknameByUserId: Map<string, string>;
  membershipIdByUserId: Map<string, string>;
  currentUserId?: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [shapeKey, setShapeKey] = useState(CUSTOM_AWARD_SHAPES[0].key);
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('');

  const held = titles.filter((t) => holderByTitleId.get(t.id)?.user_id);
  const vacant = titles.filter((t) => !holderByTitleId.get(t.id)?.user_id);

  function resetForm() {
    setShapeKey(CUSTOM_AWARD_SHAPES[0].key);
    setLabel('');
    setEmoji('');
    setError(null);
  }

  function submit() {
    const shape = CUSTOM_AWARD_SHAPES.find((s) => s.key === shapeKey);
    if (!shape) return;
    setError(null);
    startTransition(async () => {
      const result = await createCustomGroupTitle(groupId, {
        label,
        emoji,
        metric: shape.metric,
        direction: shape.direction,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setCreating(false);
        resetForm();
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteCustomGroupTitle(groupId, id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-[7px]">
      <p className="ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">Custom awards</p>

      {held.length === 0 && vacant.length === 0 && (
        <p className="rounded-2xl border border-dashed border-espresso-200 px-3.5 py-3 text-[12.5px] text-espresso-400">
          {isOwner ? "You haven't configured any yet." : "The owner hasn't configured any yet."}
        </p>
      )}

      {held.map((t) => {
        const holder = holderByTitleId.get(t.id)!;
        const shape = findShape(t.metric, t.direction);
        const nickname = holder.user_id ? (nicknameByUserId.get(holder.user_id) ?? '') : '';
        const membershipId = holder.user_id ? membershipIdByUserId.get(holder.user_id) : undefined;
        const isYours = holder.user_id === currentUserId;
        const content = (
          <>
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-honey-50 text-lg">
              {t.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-espresso-950">{t.label}</span>
              <span className="block text-[11px] leading-[1.4] text-espresso-400">{shape?.description}</span>
            </span>
            <span className="shrink-0 text-right">
              <Mention nickname={nickname} className="block text-[12.5px] font-extrabold text-espresso-950" />
              <span className="block text-[11px] font-extrabold text-honey-700">{shape?.format(holder.stat_value) ?? ''}</span>
            </span>
          </>
        );
        return (
          <div key={t.id} className="flex items-center gap-2">
            {membershipId ? (
              <Link href={`/groups/${groupId}/members/${membershipId}`} className={`flex-1 ${rowClassName} ${isYours ? 'border-honey-300 bg-honey-50/40' : ''}`}>
                {content}
              </Link>
            ) : (
              <div className={`flex-1 ${rowClassName}`}>{content}</div>
            )}
            {isOwner && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => remove(t.id)}
                className="shrink-0 text-[11.5px] font-semibold text-danger-700 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        );
      })}

      {vacant.length > 0 && (
        <div className="space-y-[7px] pt-1">
          {vacant.map((t) => {
            const shape = findShape(t.metric, t.direction);
            return (
              <div key={t.id} className="flex items-center gap-2">
                <div className={`flex-1 ${rowClassName} border-dashed`}>
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-espresso-50 text-lg opacity-60">
                    {t.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-extrabold text-espresso-400">{t.label}</span>
                    <span className="block text-[11px] leading-[1.4] text-espresso-400">Nobody qualifies yet.</span>
                  </span>
                </div>
                {isOwner && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => remove(t.id)}
                    className="shrink-0 text-[11.5px] font-semibold text-danger-700 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isOwner && titles.length < CUSTOM_AWARD_MAX_PER_GROUP && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full rounded-2xl border border-dashed border-espresso-200 px-3.5 py-3 text-center text-[12.5px] font-bold text-espresso-500 hover:bg-espresso-50"
        >
          + Create an award
        </button>
      )}

      {creating && (
        <Modal
          onClose={() => {
            setCreating(false);
            resetForm();
          }}
        >
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Create an award</p>
          {error && <p className="text-sm text-danger-700">{error}</p>}

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-espresso-500" htmlFor="award-shape">
              What it measures
            </label>
            <select id="award-shape" value={shapeKey} onChange={(e) => setShapeKey(e.target.value)} className={inputClasses}>
              {CUSTOM_AWARD_SHAPES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.menuLabel}
                </option>
              ))}
            </select>
            <p className="text-[11.5px] text-espresso-400">{CUSTOM_AWARD_SHAPES.find((s) => s.key === shapeKey)?.description}</p>
          </div>

          <div className="flex gap-2.5">
            <label className="flex-[2] space-y-1.5">
              <span className="block text-xs font-bold text-espresso-500">Name</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={CUSTOM_AWARD_LABEL_MAX_LENGTH}
                placeholder="The Menace"
                className={inputClasses}
              />
            </label>
            <label className="flex-1 space-y-1.5">
              <span className="block text-xs font-bold text-espresso-500">Emoji</span>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} placeholder="😈" className={inputClasses} />
            </label>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setCreating(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="button" className="flex-1" disabled={isPending || !label.trim() || !emoji.trim()} onClick={submit}>
              Create
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
