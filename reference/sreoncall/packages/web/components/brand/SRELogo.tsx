import { cn } from '@/lib/utils';
import Image from 'next/image';

interface SRELogoProps {
  width?: number;
  className?: string;
  branded?: boolean;
  /** If true, renders the cropped SRE-only mark (no "On Call" text) */
  mark?: boolean;
}

export function SRELogo({ width = 120, className, mark = false }: SRELogoProps) {
  // Full logo: 428×136. Mark (SRE + "On Call" side, cropped bottom): 428×100.
  const ratio = mark ? (100 / 428) : (136 / 428);
  const height = Math.round(width * ratio);

  return (
    <Image
      src={mark ? '/logo/sreoncall-logo-mark.png' : '/logo/sreoncall-logo.png'}
      alt="SREonCall"
      width={width}
      height={height}
      className={cn('object-contain', className)}
    />
  );
}
