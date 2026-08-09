import { cn, getInitials } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-20 w-20 text-2xl',
};

export function UserAvatar({ name, imageUrl, size = 'md', className }: UserAvatarProps) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={cn(
          'rounded-full object-cover',
          sizeClasses[size],
          className,
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-primary/10 font-semibold text-primary',
        sizeClasses[size],
        className,
      )}
      title={name}
    >
      {getInitials(name)}
    </div>
  );
}
