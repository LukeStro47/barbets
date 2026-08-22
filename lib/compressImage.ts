const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
const AVATAR_MAX_DIMENSION = 512;

/** Downscales and re-encodes a user-picked photo entirely client-side (no dependency) before it ever goes over the wire — phone camera photos routinely run 5-10MB, and there's no reason to upload that for a proof thumbnail. */
export async function compressImage(file: File): Promise<File> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That photo is too large (max 15MB).');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not process that photo.');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) {
    throw new Error('Could not process that photo.');
  }
  return new File([blob], 'proof.jpg', { type: 'image/jpeg' });
}

/** Same client-side downscale/compress as compressImage(), but center-crops to a square first —
    a proof photo is read as evidence and keeps its original framing, an avatar renders as a circle
    everywhere and needs to actually be square before it's ever uploaded. */
export async function compressAvatarImage(file: File): Promise<File> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That photo is too large (max 15MB).');
  }

  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const size = Math.min(side, AVATAR_MAX_DIMENSION);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not process that photo.');
  }
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) {
    throw new Error('Could not process that photo.');
  }
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}
