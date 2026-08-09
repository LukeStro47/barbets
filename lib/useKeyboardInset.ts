'use client';

import { useEffect, useState } from 'react';

const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'hidden', 'image']);

function isTextEntryElement(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type);
  return false;
}

export interface KeyboardState {
  /** Whether an on-screen keyboard is (almost certainly) up right now. Driven by focus, not by
   * `inset` below, because some WebViews — notably Android's, including Capacitor's — resize the
   * *layout* viewport itself when the keyboard opens instead of just the visual one, which makes
   * `inset` read as ~0 even with the keyboard fully up. A text field being focused on a touch
   * device is a reliable signal either way, so call sites should gate visibility (hide the bottom
   * nav, etc.) on this, not on `inset` crossing some threshold. */
  visible: boolean;
  /** How much of the viewport's bottom the keyboard is covering, via the visualViewport API —
   * `window.innerHeight - visualViewport.height - visualViewport.offsetTop`. Accurate when the
   * browser keeps the layout viewport fixed and only shrinks the visual one (iOS Safari, most
   * desktop/Android Chrome). Reads ~0 in the resize-the-whole-layout-viewport case above, which is
   * the correct number there too — a `position: fixed` bottom element's own containing block
   * already shrank to exclude the keyboard, so there's no real gap left to account for, just the
   * same small breathing-room pad a call site adds regardless. */
  inset: number;
}

export function useKeyboardState(): KeyboardState {
  const [inset, setInset] = useState(0);
  const [focused, setFocused] = useState(false);
  const [touchCapable, setTouchCapable] = useState(false);

  useEffect(() => {
    setTouchCapable(window.matchMedia('(pointer: coarse)').matches);
  }, []);

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

  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      if (isTextEntryElement(e.target)) setFocused(true);
    }
    function onFocusOut(e: FocusEvent) {
      if (isTextEntryElement(e.target)) setFocused(false);
    }
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return { visible: focused && touchCapable, inset };
}
