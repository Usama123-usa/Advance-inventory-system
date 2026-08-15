import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Card } from './Card';

// Longer values (e.g. "PKR 4,418,112.80") need a smaller font to stay on one
// line instead of wrapping mid-number — sized by character count since the
// value can be a currency string, a plain count, or anything formatted by
// the caller.
function valueFontSizeClass(value) {
  const length = String(value ?? '').length;
  if (length > 18) return 'text-lg';
  if (length > 14) return 'text-xl';
  if (length > 10) return 'text-2xl';
  return 'text-[28px]';
}

export function StatCard({ label, value, icon: Icon, trend, trendLabel, iconClassName, className, to }) {
  const Wrapper = to ? Link : 'div';
  const wrapperProps = to ? { to } : {};

  return (
    <Wrapper {...wrapperProps} className={cn(to && 'block')}>
    <Card className={cn('p-5 transition-transform hover:-translate-y-0.5', to && 'cursor-pointer hover:shadow-lg', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
          <p
            className={cn(
              'font-display mt-2 truncate font-extrabold leading-tight tracking-tight',
              valueFontSizeClass(value)
            )}
            title={String(value ?? '')}
          >
            {value}
          </p>
          {trendLabel && (
            <p
              className={cn(
                'mt-1.5 truncate text-xs font-medium',
                trend === 'up' ? 'text-success' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {trendLabel}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary', iconClassName)}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Card>
    </Wrapper>
  );
}
