'use client';

export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso-950/40 px-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-3 rounded-2xl bg-paper-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
