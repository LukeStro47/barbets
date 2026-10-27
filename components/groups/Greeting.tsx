'use client';

import { useEffect, useState } from 'react';

/** 4q's "Evening, Luke" — the part of day comes from the viewer's own clock, not the server's
 *  (a server render would greet everyone by UTC). Renders "Hello" until mounted. */
export function Greeting({ name }: { name: string }) {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 5 ? 'Evening' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening');
  }, []);
  return (
    <h1 className="text-[25px] font-extrabold tracking-[-0.022em] text-ink">
      {part ?? 'Hello'}, {name}
    </h1>
  );
}
