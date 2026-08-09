import { forwardRef, type InputHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  containerClassName?: string;
  clearAriaLabel?: string;
}

const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, containerClassName, value, onChange, placeholder = 'Search…', clearAriaLabel = 'Clear search', ...props }, ref) => {
    return (
      <div className={cn('relative', containerClassName)}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'flex h-[40px] w-full rounded-[8px] border-[1.5px] border-border bg-card dark:bg-navy-elevated pl-9 pr-9 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-50 transition-[border-color,box-shadow] duration-150',
            className,
          )}
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={clearAriaLabel}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';

export { SearchInput };
