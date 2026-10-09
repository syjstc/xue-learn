import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Coins,
  KeyRound,
  LogOut,
  Settings,
  UserRound,
} from "lucide-react";
import { getAuthUser } from "@/shared/auth";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useLearnerProfile } from "@/hooks/api/use-learner-profile";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AccountMenuProps =
  | {
      placement?: "topbar";
      triggerClassName?: string;
    }
  | {
      placement: "sidebar";
      collapsed: boolean;
      triggerClassName?: string;
      onOpenChange?: (open: boolean) => void;
    };

function LocalAccountMenu(props: AccountMenuProps) {
  const t = useT();
  const user = getAuthUser();
  const learnerProfile = useLearnerProfile(Boolean(user));
  if (!user) return null;
  const placement = props.placement ?? "topbar";
  const inSidebar = placement === "sidebar";
  const collapsed = props.placement === "sidebar" ? props.collapsed : false;
  const onOpenChange =
    props.placement === "sidebar" ? props.onOpenChange : undefined;
  const displayName =
    learnerProfile.data?.profile.nickname?.trim() ||
    t("desktop.account.localLearner");

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            title={collapsed ? displayName : undefined}
            aria-label={collapsed ? displayName : undefined}
            className={cn(
              inSidebar
                ? "h-10 w-full rounded-lg text-[var(--text-500)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]"
                : "h-8 gap-1.5 rounded-lg px-2.5 text-xs text-[var(--text-500)]",
              collapsed
                ? "justify-center px-2"
                : inSidebar
                  ? "justify-start px-2.5"
                  : undefined,
              props.triggerClassName,
            )}
          />
        }
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-50)] text-[var(--brand-700)]">
          <UserRound className="size-3.5" aria-hidden />
        </span>
        {!collapsed ? (
          <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
            {displayName}
          </span>
        ) : null}
        {!collapsed && inSidebar ? (
          <ChevronRight className="size-3.5 shrink-0 opacity-50" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={inSidebar ? "right" : "bottom"}
        align="end"
        sideOffset={inSidebar ? 8 : 4}
        className="w-56"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Link to="/settings">
            <Settings className="size-4" />
            {t("common.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Link to="/local/api-keys">
            <KeyRound className="size-4" />
            {t("desktop.deviceSettings.title")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AccountMenu(props: AccountMenuProps) { return <LocalAccountMenu {...props} />; }
