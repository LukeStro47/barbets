'use client';

import { useEffect, useState } from 'react';

/** How much of the viewport's bottom the on-screen keyboard is currently covering, tracked via
 * the visualViewport API (well-supported in mobile Safari/Chrome and Capacitor's WebViews) —
 * `window.innerHeight - visualViewport.height - visualViewport.offsetTop`. 0 when no keyboard
 * (or the browser doesn't expose visualViewport) is up. A `position: fixed` element still uses
 * the *layout* viewport, which doesn't shrink when the keyboard opens, so it visually floats on
 * top of the keyboard instead of being covered by it — this is what call sites use to react to
 * that instead. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const diff = window.innerHeight - vv!.height - vv!.offsetTop;
      setInset(Math.max(0, Math.round(diff)));
    }

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
