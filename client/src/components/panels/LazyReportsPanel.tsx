import { lazy, Suspense, type ComponentProps } from 'react';
import { Skeleton } from '@/components/ui/Feedback';

// The charting library is large, so the reports UI is only downloaded when a reports view is opened.
const Inner = lazy(() => import('./ReportsPanel').then((m) => ({ default: m.ReportsPanel })));

export function ReportsPanel(props: ComponentProps<typeof Inner>) {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-28 w-full" /><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></div>}>
      <Inner {...props} />
    </Suspense>
  );
}
