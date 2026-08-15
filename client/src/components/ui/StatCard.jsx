import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Card } from './Card';

export function StatCard({ label, value, icon: Icon, trend, trendLabel, iconClassName, className, to }) {
  const Wrapper = to ? Link : 'div';
  const wrapperProps = to ? { to } : {};

  return (
    <Wrapper {...wrapperProps} className={cn(to && 'block')}>
    <Card className={cn('p-5 transition-transform hover:-translate-y-0.5', to && 'cursor-pointer hover:shadow-lg', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
          <p className="font-display mt-2 break-words text-[28px] font-extrabold leading-tight tracking-tight">{value}</p>
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
