import { useState } from 'react';
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { consumeSsePost } from '@/shared/client/consume-sse';
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function TeachingPresentationControls(props: {
  unitId: string; sectionId: string; revision: number; canRestore: boolean;
  disabled?: boolean; onUpdated: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const update = async (action: 'enhance' | 'restore') => {
    setBusy(true); setError(''); setStatus(t('teachingDerivation.enhancing'));
    try {
      let done = false;
      await consumeSsePost(`/api/units/${props.unitId}/sections/${props.sectionId}/teaching-presentation/stream`, { action, expectedRevision: props.revision }, event => {
        if (event.type === 'status' && event.message) setStatus(String(event.message));
        if (event.type === 'error') throw new Error(String(event.message ?? t('teachingDerivation.enhancementFailed')));
        if (event.type === 'done') done = true;
      });
      if (!done) throw new Error(t('teachingDerivation.enhancementFailed'));
      await props.onUpdated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); setStatus(''); }
  };
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy || props.disabled} onClick={() => void update('enhance')}>{t('teachingDerivation.enhance')}</Button>
      {props.canRestore ? <Button size="sm" variant="ghost" disabled={busy || props.disabled} onClick={() => void update('restore')}>{t('teachingDerivation.restore')}</Button> : null}
      {status ? <span role="status" className="text-sm text-muted-foreground">{status}</span> : null}
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
