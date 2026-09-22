import { useState } from 'react';
import { Plus, UserCog } from 'lucide-react';
import { ROLES, USER_STATUSES } from '@shared/enums';
import { useApi } from '@/api/hooks';
import type { Paged, UserRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { FilterBar, FilterSelect, SearchInput, useDebounced, useEnumOptions } from '@/components/ui/Filters';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { UserFormModal } from '@/components/forms/UserFormModal';

export function UsersPage() {
  const { t, fmt } = useI18n();
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const q = useDebounced(search);
  const list = useApi<Paged<UserRow>>('/users', { q, role, status, page });
  const roleOptions = useEnumOptions('role', ROLES);
  const statusOptions = useEnumOptions('userStatus', USER_STATUSES);

  return (
    <div>
      <PageHeader title={t('nav.users')} subtitle={t('user.subtitle')} actions={<Button variant="brand" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{t('user.new')}</Button>} />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t('user.search')} />
        <FilterSelect value={role} onChange={(v) => { setRole(v); setPage(1); }} allLabel={t('user.allRoles')} options={roleOptions} />
        <FilterSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} allLabel={t('common.allStatuses')} options={statusOptions} />
      </FilterBar>
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? (
        <EmptyState icon={UserCog} title={t('user.empty')} description={t('common.noResultsHint')} />
      ) : (
        <>
          <DataList
            rows={list.data.items}
            rowKey={(u) => u.id}
            onRowClick={(u) => setEditing(u)}
            leading={(u) => <Avatar name={u.name} />}
            columns={[
              { key: 'name', header: t('common.name'), primary: true, cell: (u) => <div><p className="font-medium text-zinc-900">{u.name}{u.id === me?.id && <span className="ms-2 text-xs font-normal text-zinc-400">({t('user.you')})</span>}</p><p dir="ltr" className="text-start text-xs font-normal text-zinc-500">{u.email}</p></div> },
              { key: 'role', header: t('user.role'), cell: (u) => <StatusBadge group="role" value={u.role} /> },
              { key: 'client', header: t('client.title'), cell: (u) => (u.client ? u.client.companyName : <span className="text-zinc-400">—</span>) },
              { key: 'status', header: t('common.status'), cell: (u) => <StatusBadge group="userStatus" value={u.status} /> },
              { key: 'lang', header: t('settings.language'), hideOnTablet: true, hideOnMobile: true, cell: (u) => <Badge dot={false}>{u.locale === 'ar' ? 'العربية' : 'English'}</Badge> },
              { key: 'last', header: t('user.lastLogin'), hideOnTablet: true, cell: (u) => <span className="text-zinc-500">{u.lastLoginAt ? fmt.relative(u.lastLoginAt) : t('user.never')}</span> },
            ]}
          />
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      {editing && <UserFormModal open onClose={() => setEditing(null)} user={editing === 'new' ? undefined : editing} />}
    </div>
  );
}
