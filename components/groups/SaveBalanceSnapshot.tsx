'use client';

import { useEffect } from 'react';
import { saveGroupBalanceSnapshot } from '@/lib/offlineSnapshot';

/** Renders nothing — just records this group's balance to localStorage on every successful
    load, so the offline page (app/offline/page.tsx) has something to show. */
export function SaveBalanceSnapshot({
  groupId,
  groupName,
  balance,
}: {
  groupId: string;
  groupName: string;
  balance: number;
}) {
  useEffect(() => {
    saveGroupBalanceSnapshot({ groupId, groupName, balance });
  }, [groupId, groupName, balance]);

  return null;
}
