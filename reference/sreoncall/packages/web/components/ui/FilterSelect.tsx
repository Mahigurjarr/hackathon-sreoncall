import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  icon?: ReactNode;
  containerClassName?: string;
}

const FilterSelect = forwardRef<HTMLSelectElement, FilterSelectProps>(
  ({ label, icon, className, containerClassName, value, children, ...props }, ref) => {
    const isActive = value !== undefined && value !== '' && value !== null;
    const ariaLabel = props['aria-label'] ?? `${label} filter`;
    return (
      <div
        className={cn(
          'group relative inline-flex h-[34px] items-center gap-1.5 rounded-full border-[1.5px] pl-3 pr-6 text-[12.5px] transition-colors',
          isActive
            ? 'border-[#FF6B2B] bg-[#FFF3ED] text-[#C84F14] dark:bg-[#FF6B2B]/10 dark:text-[#FF8F4F]'
            : 'border-border bg-card text-foreground hover:border-[#FF6B2B]/50 hover:bg-muted/60',
          containerClassName,
        )}
      >
        {icon && (
          <span
            className={cn(
              '[&>svg]:h-3.5 [&>svg]:w-3.5 flex-shrink-0',
              isActive ? 'text-[#FF6B2B]' : 'text-muted-foreground',
            )}
          >
            {icon}
          </span>
        )}
        <span
          className={cn(
            'flex-shrink-0 font-medium',
            isActive ? 'text-[#C84F14] dark:text-[#FF8F4F]/80' : 'text-muted-foreground',
          )}
        >
          {label}:
        </span>
        <select
          ref={ref}
          value={value ?? ''}
          aria-label={ariaLabel}
          className={cn(
            'absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 focus:outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <span className="pointer-events-none truncate font-semibold">
          {getSelectedLabel(children, value)}
        </span>
        <ChevronDown
          className={cn(
            'pointer-events-none absolute right-2 h-3.5 w-3.5',
            isActive ? 'text-[#FF6B2B]' : 'text-muted-foreground',
          )}
        />
      </div>
    );
  },
);
FilterSelect.displayName = 'FilterSelect';

function getSelectedLabel(children: ReactNode, value: unknown): string {
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr.flat()) {
    if (
      child &&
      typeof child === 'object' &&
      'props' in child &&
      (child as any).props?.value === (value ?? '')
    ) {
      const label = (child as any).props.children;
      if (typeof label === 'string') return label;
      if (Array.isArray(label)) return label.join('');
    }
  }
  return 'All';
}

export { FilterSelect };
