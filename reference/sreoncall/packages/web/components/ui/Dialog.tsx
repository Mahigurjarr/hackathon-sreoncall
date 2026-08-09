'use client';

import { useEffect, useRef, type ReactNode, type HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wrapperClassName?: string;
}

function Dialog({ open, onClose, children, wrapperClassName }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }

    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="fixed inset-0 bg-black/50 backdrop-blur-[4px]"
        onClick={onClose}
      />
      {/* Content wrapper */}
      <div className={cn('relative z-[1001] w-full max-w-[540px] mx-4 max-h-[calc(100vh-80px)]', wrapperClassName)}>{children}</div>
    </div>
  );
}

function DialogContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cn(
        'relative rounded-[16px] border border-border bg-card dark:bg-navy-surface shadow-[0_8px_24px_rgba(0,0,0,0.2)] animate-in fade-in-0 zoom-in-95 max-h-[inherit] overflow-y-auto',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-6 pr-14 py-5 border-b border-border flex items-center justify-between', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-lg font-bold leading-none tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

function DialogClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      className="absolute right-5 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </button>
  );
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose };
