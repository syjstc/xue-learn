import {useT} from '@xue-learn/core/i18n';
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@xue-learn/core/ui/sheet';
import {Link} from 'react-router-dom';
import {ThemeSettingsForm} from '../../../desktop/src/components/settings/theme-settings-form';
import {LearningViewSettingsForm} from '../../../desktop/src/components/settings/learning-view-settings-form';

export function QuickSettingsPanel({open, onClose}: {
  open: boolean; onClose: () => void; unitId?: string | null;
}) {
  const t = useT();
  return <Sheet open={open} onOpenChange={next => !next && onClose()}>
    <SheetContent side="right" className="w-full p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
      <SheetHeader className="border-b px-4 py-3 text-left">
        <SheetTitle>{t('quickSettings.title')}</SheetTitle>
        <SheetDescription className="sr-only">{t('quickSettings.description')}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-xl border bg-card p-4"><LearningViewSettingsForm /></section>
        <section className="rounded-xl border bg-card p-4"><ThemeSettingsForm compact /></section>
        <Link to="/settings" onClick={onClose} className="text-sm font-medium text-primary hover:underline">{t('quickSettings.fullSettingsLink')}</Link>
      </div>
    </SheetContent>
  </Sheet>;
}
