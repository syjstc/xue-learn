import {Link} from 'react-router-dom';
import {Settings} from 'lucide-react';
import {useT} from '@xue-learn/core/i18n';
import {cn} from '@xue-learn/core/utils';

/** Keep learning preferences reachable without a second account/profile menu. */
export function AccountMenu({collapsed = false, triggerClassName}: {
  placement?: 'sidebar' | 'topbar'; collapsed?: boolean; triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  return <Link to="/settings" title={t('common.settings')} aria-label={t('common.settings')}
    className={cn('flex h-10 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
      collapsed && 'justify-center px-2', triggerClassName)}>
    <Settings className="size-4 shrink-0" aria-hidden />
    {!collapsed && <span>{t('common.settings')}</span>}
  </Link>;
}
