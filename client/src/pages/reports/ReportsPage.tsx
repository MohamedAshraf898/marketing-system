import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReportsPanel } from '@/components/panels/LazyReportsPanel';
import { ReportFormModal } from '@/components/forms/ReportFormModal';

export function ReportsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const staff = user?.role !== 'CLIENT';
  return (
    <div>
      <PageHeader title={t('nav.reports')} subtitle={t('report.subtitle')} actions={staff && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{t('report.new')}</Button>} />
      <ReportsPanel />
      {adding && <ReportFormModal open onClose={() => setAdding(false)} />}
    </div>
  );
}
