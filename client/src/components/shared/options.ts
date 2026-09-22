import type { Campaign, Client, Paged } from '@/api/types';
import { useApi } from '@/api/hooks';

export function useClientOptions(enabled = true) {
  const q = useApi<Paged<Client>>('/clients', { pageSize: 100 }, { enabled });
  return { clients: q.data?.items ?? [], loading: q.isLoading };
}

export function useCampaignOptions(clientId?: string, enabled = true) {
  const q = useApi<Paged<Campaign>>('/campaigns', { pageSize: 100, clientId }, { enabled });
  return { campaigns: q.data?.items ?? [], loading: q.isLoading };
}

export function useTeamMembers(clientId?: string, enabled = true) {
  const q = useApi<{ items: Array<{ id: string; name: string; role: string }> }>('/team-members', { clientId }, { enabled });
  return q.data?.items ?? [];
}

/** Minimal shape only (name for a picker) - avoids depending on another group's api/types.work.ts. */
export function useProjectOptions(clientId?: string, enabled = true) {
  const q = useApi<Paged<{ id: string; name: string }>>('/projects', { clientId, pageSize: 100 }, { enabled });
  return { projects: q.data?.items ?? [], loading: q.isLoading };
}
