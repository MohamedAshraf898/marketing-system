import { useI18n, type TKey } from '@/i18n';

/** The default checklist is stored with these English titles; the UI shows them translated (custom titles are shown as typed). */
const KEYS: Record<string, TKey> = {
  'Contract signed': 'crm.onb.title.contractSigned',
  'First invoice sent': 'crm.onb.title.firstInvoiceSent',
  'Access to ad accounts': 'crm.onb.title.adAccounts',
  'Brand assets received': 'crm.onb.title.brandAssets',
  'Social media access': 'crm.onb.title.socialAccess',
  'Kickoff meeting completed': 'crm.onb.title.kickoff',
  'First campaign planned': 'crm.onb.title.firstCampaign',
  'First deliverable approved': 'crm.onb.title.firstDeliverable',
};

export function useOnboardingTitle() {
  const { t } = useI18n();
  return (title: string) => (KEYS[title] ? t(KEYS[title]) : title);
}
