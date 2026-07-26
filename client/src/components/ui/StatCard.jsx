import { cn } from '@/lib/utils';
import { Card } from './Card';

export function StatCard({ label, value, icon: Icon, trend, trendLabel, iconClassName, className }) {
  return (
    <Card className={cn('p-5 transition-transform hover:-translate-y-0.5', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
          {trendLabel && (
            <p
              className={cn(
                'mt-1.5 text-xs font-medium',
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
  );
}
