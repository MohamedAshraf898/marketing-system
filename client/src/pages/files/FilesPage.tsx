import { useState } from 'react';
import { Upload } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilesPanel } from '@/components/panels/FilesPanel';
import { UploadFileModal } from '@/components/forms/UploadFileModal';

export function FilesPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  return (
    <div>
      <PageHeader title={t('nav.files')} subtitle={t('file.subtitle')} actions={user?.role !== 'CLIENT' && <Button variant="brand" icon={<Upload className="size-4" />} onClick={() => setUploading(true)}>{t('file.upload')}</Button>} />
      <FilesPanel />
      {uploading && <UploadFileModal open onClose={() => setUploading(false)} />}
    </div>
  );
}
