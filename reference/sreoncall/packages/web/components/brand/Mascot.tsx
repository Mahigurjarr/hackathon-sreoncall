import { cn } from '@/lib/utils';
import Image from 'next/image';

type MascotPose = 'stand' | 'happy' | 'anim';
type MascotFormat = 'svg' | 'png' | 'gif';

/**
 * Surface context for rendering adjustments.
 * PNGs now have true alpha transparency (no white background).
 * - 'light': rendered as-is on light backgrounds
 * - 'dark': low opacity ghost on dark backgrounds
 * - 'hero': drop-shadow for presence
 */
type MascotSurface = 'light' | 'dark' | 'hero';

interface MascotProps {
  /** Which mascot pose to render */
  pose?: MascotPose;
  /** Width in pixels (height auto-scales) */
  width?: number;
  /** Height in pixels (optional override) */
  height?: number;
  /** CSS class for the wrapper */
  className?: string;
  /** Animation class to apply */
  animation?: 'float' | 'bounce' | 'glow' | 'shake' | 'none';
  /** Opacity (0-100) */
  opacity?: number;
  /** Preferred format. Defaults: 'stand'/'happy' use png, 'anim' uses gif */
  format?: MascotFormat;
  /** Surface context for blend mode (default: 'light') */
  surface?: MascotSurface;
}

const poseAspectRatios: Record<MascotPose, number> = {
  stand: 289 / 400,   // from viewBox
  happy: 296 / 400,
  anim: 90 / 160,
};

const defaultFormats: Record<MascotPose, MascotFormat> = {
  stand: 'png',
  happy: 'png',
  anim: 'gif',
};

const animationClasses: Record<string, string> = {
  float: 'animate-mascot-float',
  bounce: 'animate-mascot-bounce',
  glow: 'animate-mascot-glow',
  shake: 'animate-mascot-shake',
  none: '',
};

function getMascotSrc(pose: MascotPose, format: MascotFormat): string {
  const ext = format === 'gif' ? 'gif' : format;
  return `/mascot/mascot-${pose}.${ext}`;
}

/**
 * SREonCall Mascot component.
 * Renders the official brand mascot extracted from design-system-final.svg.
 *
 * Placement rules (from design spec):
 * - Dashboard welcome: pose="happy", width=160, opacity=90
 * - Sidebar footer: pose="happy", width=60, opacity=15
 * - Empty states: pose="stand", width=120, opacity=60
 * - Login: DO NOT USE (per design spec comment "NO MASCOT")
 */
const surfaceStyles: Record<MascotSurface, React.CSSProperties> = {
  light: { mixBlendMode: 'multiply' as const },
  dark: { mixBlendMode: 'screen' as const, opacity: 0.7 },
  hero: { filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.15))' },
};

export function Mascot({
  pose = 'stand',
  width = 200,
  height,
  className,
  animation = 'none',
  opacity = 100,
  format,
  surface = 'light',
}: MascotProps) {
  const resolvedFormat = format ?? defaultFormats[pose];
  const src = getMascotSrc(pose, resolvedFormat);
  const computedHeight = height ?? Math.round(width * poseAspectRatios[pose]);

  return (
    <div
      className={cn(
        'pointer-events-none select-none',
        animationClasses[animation],
        className,
      )}
      style={{ opacity: opacity / 100 }}
    >
      <Image
        src={src}
        alt={`SREonCall mascot — ${pose}`}
        width={width}
        height={computedHeight}
        priority={false}
        unoptimized
        className="object-contain"
        style={surfaceStyles[surface]}
      />
    </div>
  );
}

/**
 * Pre-configured mascot placements matching the design spec.
 */
export function MascotDashboard({ className }: { className?: string }) {
  return (
    <Mascot
      pose="happy"
      width={160}
      opacity={90}
      animation="float"
      surface="hero"
      className={className}
    />
  );
}

export function MascotSidebarFooter({ className }: { className?: string }) {
  return (
    <Mascot
      pose="happy"
      width={70}
      opacity={20}
      surface="dark"
      className={cn('absolute right-2 bottom-16', className)}
    />
  );
}

export function MascotEmptyState({ className }: { className?: string }) {
  return (
    <Mascot
      pose="stand"
      width={120}
      opacity={60}
      surface="light"
      className={cn('mb-4', className)}
    />
  );
}

export function MascotSuccess({ className }: { className?: string }) {
  return (
    <Mascot
      pose="happy"
      width={48}
      animation="bounce"
      className={cn('shrink-0', className)}
    />
  );
}
