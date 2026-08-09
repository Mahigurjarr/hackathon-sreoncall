import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-[40px] w-full rounded-[8px] border-[1.5px] border-border bg-card dark:bg-navy-elevated px-4 py-2 text-[13px] text-foreground ring-offset-background focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-50 transition-[border-color,box-shadow] duration-150',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';

export { Select };
