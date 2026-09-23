'use client';

import { useState } from 'react';
import { ManageNavRow } from '@/components/ui/SettingsList';
import { Modal } from '@/components/ui/Modal';
import { NicknameEditor } from '@/components/groups/NicknameEditor';
import { LeaveGroupButton } from '@/components/groups/LeaveGroupButton';
import { ForfeitModeratorButton } from '@/components/groups/ForfeitModeratorButton';

export function YouInGroupSheet({
  groupId,
  groupName,
  nickname,
  isOwner,
  isPublic,
  isModerator,
}: {
  groupId: string;
  groupName: string;
  nickname: string;
  isOwner: boolean;
  isPublic: boolean;
  isModerator: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ManageNavRow
        onClick={() => setOpen(true)}
        title="You in this group"
        subtitle={
          <>
            Playing as <span className="italic">@{nickname}</span>
          </>
        }
      />
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-ink">You in this group</p>
          <p className="text-xs text-faint">How everyone sees you here.</p>
          {nickname && <NicknameEditor groupId={groupId} nickname={nickname} />}
          {isPublic && isModerator && !isOwner && <ForfeitModeratorButton groupId={groupId} groupName={groupName} />}
          {!isOwner && <LeaveGroupButton groupId={groupId} groupName={groupName} />}
        </Modal>
      )}
    </>
  );
}
