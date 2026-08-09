import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'rounded-[8px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-white shadow-[0_1px_3px_rgba(255,107,43,0.3)] hover:shadow-[0_4px_12px_rgba(255,107,43,0.4)] hover:-translate-y-[1px] active:translate-y-0',
        destructive:
          'rounded-[8px] bg-[#FEE2E2] text-[#DC2626] hover:bg-[#FECACA]',
        outline:
          'rounded-[8px] border-[1.5px] border-[#FF6B2B] bg-transparent text-[#FF6B2B] hover:bg-[#FFF3ED]',
        secondary:
          'rounded-[8px] bg-[#1E293B] text-white border border-white/10 hover:bg-[#334155]',
        info:
          'rounded-[8px] bg-[#2563EB] text-white hover:bg-[#1D4ED8]',
        ghost:
          'rounded-[8px] hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        sm: 'h-[34px] px-3.5 text-[13px]',
        default: 'h-[42px] px-5 text-[14px]',
        lg: 'h-[48px] px-7 text-[15px]',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
