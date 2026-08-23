'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { AVATAR_OUTPUT_SIZE, JPEG_QUALITY, MAX_INPUT_BYTES } from '@/lib/compressImage';

const VIEWPORT = 260;
const MAX_ZOOM = 3;

interface Offset {
  x: number;
  y: number;
}

function clampOffset(offset: Offset, displayWidth: number, displayHeight: number): Offset {
  const maxX = Math.max(0, (displayWidth - VIEWPORT) / 2);
  const maxY = Math.max(0, (displayHeight - VIEWPORT) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, offset.x)), y: Math.min(maxY, Math.max(-maxY, offset.y)) };
}

/**
 * A pinch-free, drag-and-slider crop step between picking a photo and uploading it. Replaces the
 * old auto-center-square-crop (compressAvatarImage): a photo where the face isn't already dead
 * center used to just get cut off with no way to fix it. Deliberately hand-rolled rather than a
 * cropping library — same "entirely client-side, no dependency" posture compressImage.ts already
 * uses for the proof-photo path, just extended to cover repositioning too.
 *
 * The circular viewport is cosmetic (avatars always render as circles), the actual exported file
 * is a square — UserAvatar's rounded-full clipping does the rest, same as every other avatar.
 */
export function AvatarCropper({
  file,
  busy = false,
  onCancel,
  onConfirm,
}: {
  file: File;
  /** Disables the controls once a crop has been confirmed and the upload is in flight, so a slow
      network can't be raced into submitting the same crop twice. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: File) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  if (!objectUrlRef.current) {
    objectUrlRef.current = URL.createObjectURL(file);
  }

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (file.size > MAX_INPUT_BYTES) setError('That photo is too large (max 15MB).');
  }, [file]);

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-danger-700">{error}</p>
        <Button type="button" variant="outline" className="w-full" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }

  const scale0 = naturalSize ? VIEWPORT / Math.min(naturalSize.width, naturalSize.height) : 1;
  const scale = scale0 * zoom;
  const displayWidth = naturalSize ? naturalSize.width * scale : VIEWPORT;
  const displayHeight = naturalSize ? naturalSize.height * scale : VIEWPORT;

  function updateZoom(nextZoom: number) {
    if (!naturalSize) return;
    setZoom(nextZoom);
    const nextScale = scale0 * nextZoom;
    setOffset((prev) => clampOffset(prev, naturalSize.width * nextScale, naturalSize.height * nextScale));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !naturalSize) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy }, displayWidth, displayHeight));
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  function confirm() {
    const img = imgRef.current;
    if (!img || !naturalSize) return;
    const imgLeft = VIEWPORT / 2 - displayWidth / 2 + offset.x;
    const imgTop = VIEWPORT / 2 - displayHeight / 2 + offset.y;
    const sourceSize = VIEWPORT / scale;
    const sx = -imgLeft / scale;
    const sy = -imgTop / scale;

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Could not process that photo.');
      return;
    }
    ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Could not process that photo.');
          return;
        }
        onConfirm(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  }

  return (
    <div className="space-y-4">
      <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Position your photo</p>

      <div
        className="relative mx-auto touch-none overflow-hidden rounded-full bg-espresso-50 select-none"
        style={{ width: VIEWPORT, height: VIEWPORT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, not a remote asset */}
        <img
          ref={imgRef}
          src={objectUrlRef.current}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const el = e.currentTarget;
            setNaturalSize({ width: el.naturalWidth, height: el.naturalHeight });
          }}
          className="absolute top-1/2 left-1/2 max-w-none"
          style={{
            width: displayWidth,
            height: displayHeight,
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
          }}
        />
      </div>

      <div className="flex items-center gap-2.5 px-1">
        <span className="text-xs font-bold text-espresso-400">Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => updateZoom(Number(e.target.value))}
          disabled={!naturalSize || busy}
          className="flex-1 accent-honey-500"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" className="flex-1" disabled={!naturalSize || busy} onClick={confirm}>
          {busy ? 'Uploading…' : 'Use photo'}
        </Button>
      </div>
    </div>
  );
}
