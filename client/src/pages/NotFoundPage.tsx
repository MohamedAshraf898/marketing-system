import { Compass } from 'lucide-react';
import { useI18n } from '@/i18n';
import { LinkButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';

export function NotFoundPage() {
  const { t } = useI18n();
  return <EmptyState icon={Compass} title={t('notFound.title')} description={t('notFound.text')} action={<LinkButton to="/" variant="primary">{t('notFound.home')}</LinkButton>} />;
}
