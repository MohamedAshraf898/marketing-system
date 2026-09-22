import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Meta } from '@/api/types';
import { useI18n } from '@/i18n';
import { Button } from './Button';

export function Pagination({ meta, onPage }: { meta?: Meta; onPage: (p: number) => void }) {
  const { t, fmt } = useI18n();
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-4">
      <p className="text-[13px] text-zinc-500 tabular">{t('common.pageOf', { page: fmt.number(meta.page), total: fmt.number(meta.totalPages) })}</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} icon={<ChevronLeft className="size-4 rtl:rotate-180" />}>{t('common.previous')}</Button>
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          {t('common.next')}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}
