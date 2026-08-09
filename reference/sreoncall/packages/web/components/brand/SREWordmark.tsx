import { cn } from '@/lib/utils';
import { SRELogo } from './SRELogo';

interface SREWordmarkProps {
  /** 'full' shows logo + text, 'logo' shows just the SVG mark, 'text' shows just text */
  variant?: 'full' | 'logo' | 'text';
  /** Size preset */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Light version (white text for dark backgrounds) */
  light?: boolean;
}

const sizeConfig = {
  sm: { logoWidth: 60, textClass: 'text-sm', gap: 'gap-2' },
  md: { logoWidth: 80, textClass: 'text-lg', gap: 'gap-3' },
  lg: { logoWidth: 100, textClass: 'text-xl', gap: 'gap-3' },
  xl: { logoWidth: 130, textClass: 'text-3xl', gap: 'gap-3' },
};

export function SREWordmark({
  variant = 'full',
  size = 'md',
  className,
  light = false,
}: SREWordmarkProps) {
  const config = sizeConfig[size];

  if (variant === 'logo') {
    return <SRELogo width={config.logoWidth} branded={light} className={className} />;
  }

  if (variant === 'text') {
    return (
      <span className={cn('font-bold', config.textClass, light ? 'text-white' : 'text-foreground', className)}>
        SRE<span className="text-brand">onCall</span>
      </span>
    );
  }

  // Full: logo SVG + text wordmark
  return (
    <div className={cn('flex items-center', config.gap, className)}>
      <SRELogo width={config.logoWidth} branded={light} />
      <span className={cn('font-bold', config.textClass, light ? 'text-white' : 'text-foreground')}>
        SRE<span className="text-brand">onCall</span>
      </span>
    </div>
  );
}
