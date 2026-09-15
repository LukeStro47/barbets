'use client';

import { useState } from 'react';
import { ManageNavRow } from '@/components/ui/SettingsList';
import { Modal } from '@/components/ui/Modal';
import { StakesEditor } from '@/components/groups/StakesEditor';
import type { GroupSettings } from '@/lib/actions/groups';

export function PrizePunishmentSheet({
  groupId,
  settings,
  canEdit,
  subtitle,
  backLabel,
}: {
  groupId: string;
  settings: GroupSettings;
  canEdit: boolean;
  subtitle: string;
  backLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ManageNavRow onClick={() => setOpen(true)} title="Prize / Punishment" subtitle={subtitle} />
      {open && (
        <Modal onClose={() => setOpen(false)} panelClassName="max-w-md">
          <StakesEditor
            groupId={groupId}
            settings={settings}
            isPublic={false}
            canEdit={canEdit}
            chrome="modal"
            backLabel={backLabel}
          />
        </Modal>
      )}
    </>
  );
}
