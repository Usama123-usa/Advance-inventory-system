import { cn } from '@/lib/utils';

export function Label({ className, ...props }) {
  return (
    <label
      className={cn('text-sm font-medium leading-none text-foreground/90 peer-disabled:opacity-70', className)}
      {...props}
    />
  );
}
