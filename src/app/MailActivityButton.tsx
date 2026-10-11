import { Activity } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useServices } from './services';

export function MailActivityButton() {
  const { mail, platform } = useServices();
  const [error, setError] = useState<string>();
  if (!mail.connection || !platform.openMailActivityWindow) return null;
  return (
    <div className="no-drag">
      <Button
        className="w-full justify-start"
        onClick={() => {
          setError(undefined);
          void platform.openMailActivityWindow!().catch(() =>
            setError('Could not open Gmail activity'),
          );
        }}
      >
        <Activity size={15} aria-hidden="true" /> Gmail activity
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-[12px]">
          {error}
        </p>
      )}
    </div>
  );
}
