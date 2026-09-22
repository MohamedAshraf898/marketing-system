import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { ClientTimeReport } from './ClientTimeReport';
import { MyTimeTab } from './MyTimeTab';

/** "My time": timer, totals, week strip and entries. Users with time.view_all (or ADMIN) also get the team filter and the client time report. */
export function TimePage() {
  const { t } = useI18n();
  const { user, can } = useAuth();
  const viewAll = user?.role === 'ADMIN' || can('time.view_all');
  const [tab, setTab] = useState<'mine' | 'report'>('mine');
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title={t('time.title')}
        subtitle={t('time.subtitle')}
        actions={tab === 'mine' && <Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setCreating(true)} className="max-sm:h-11">{t('time.addEntry')}</Button>}
      />
      {viewAll && (
        <Tabs
          className="mb-6"
          value={tab}
          onChange={setTab}
          tabs={[{ id: 'mine', label: t('time.tab.mine') }, { id: 'report', label: t('time.tab.report') }]}
        />
      )}
      {tab === 'mine' || !viewAll ? <MyTimeTab viewAll={viewAll} creating={creating} setCreating={setCreating} /> : <ClientTimeReport />}
    </div>
  );
}
