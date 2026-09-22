import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { RequestsPanel } from '@/components/panels/RequestsPanel';
import { RequestFormModal } from '@/components/forms/RequestFormModal';

export function RequestsPage() {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title={t('nav.requests')} subtitle={t('request.subtitle')} actions={<Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)} className="max-sm:h-11">{t('request.new')}</Button>} />
      <RequestsPanel />
      {creating && <RequestFormModal open onClose={() => setCreating(false)} />}
    </div>
  );
}
