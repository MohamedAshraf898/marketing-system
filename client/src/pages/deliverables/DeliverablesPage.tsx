import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DeliverablesPanel } from '@/components/panels/DeliverablesPanel';
import { DeliverableFormModal } from '@/components/forms/DeliverableFormModal';

export function DeliverablesPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title={t('nav.deliverables')} subtitle={t('deliverable.subtitle')} actions={user?.role !== 'CLIENT' && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('deliverable.new')}</Button>} />
      <DeliverablesPanel />
      {creating && <DeliverableFormModal open onClose={() => setCreating(false)} />}
    </div>
  );
}
