import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/* SVG Section 04: Badge specs — rx=5, 10px w700 for priority/severity, exact hex colors */
const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-[5px] border px-2 py-0.5 text-[10px] font-bold tracking-[0.02em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground',
        destructive:
          'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]',
        outline: 'text-foreground',
        success:
          'border-[#BBF7D0] bg-[#F0FDF4] text-[#16A34A]',
        warning:
          'border-[#FDE68A] bg-[#FEFCE8] text-[#A16207]',
        info:
          'border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]',
        ai:
          'border-purple-200/20 bg-[rgba(124,58,237,0.08)] text-[#7C3AED]',
        /* Priority — exact SVG hex values */
        p1: 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]',
        p2: 'border-[#FED7AA] bg-[#FFF7ED] text-[#EA580C]',
        p3: 'border-[#FDE68A] bg-[#FEFCE8] text-[#A16207]',
        p4: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]',
        p5: 'border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]',
        /* Severity — same scale */
        sev1: 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]',
        sev2: 'border-[#FED7AA] bg-[#FFF7ED] text-[#EA580C]',
        sev3: 'border-[#FDE68A] bg-[#FEFCE8] text-[#A16207]',
        sev4: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]',
        sev5: 'border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
