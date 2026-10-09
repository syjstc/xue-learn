import { mainlineEnabled } from "@/features/learning-mainline/enabled";
import { isDev } from "@xue-learn/core/dev";
import type { ReactNode } from "react";
import { GoalWorkspaceSubview } from "@/components/layout/goal-workspace-subview";
import { SettingsWorkspaceSubview } from "@/components/layout/settings-workspace-subview";

export type WorkspaceSidebarViewContext = {
  pathname: string;
  goalSubviewId: string | null;
};

export type WorkspaceSidebarView = {
  id: string;
  locksSidebarOpen?: boolean;
  render: () => ReactNode;
};

export type WorkspaceSidebarViewRegistration = {
  id: string;
  resolve: (
    context: WorkspaceSidebarViewContext,
  ) => WorkspaceSidebarView | null;
};

/**
 * Contextual views that replace the learning-space tree in the lower explorer.
 * Add route-owned sidebar experiences here instead of branching WorkspaceShell.
 */
export const WORKSPACE_SIDEBAR_VIEW_REGISTRY: readonly WorkspaceSidebarViewRegistration[] =
  [
    {
      id: "settings",
      resolve: ({ pathname }) =>
        pathname === "/settings"
          ? {
              id: "settings",
              locksSidebarOpen: true,
              render: () => <SettingsWorkspaceSubview />,
            }
          : null,
    },
    {
      id: "goal",
      resolve: ({ goalSubviewId }) =>
        goalSubviewId && (!mainlineEnabled() || isDev())
          ? {
              id: `goal:${goalSubviewId}`,
              render: () => <GoalWorkspaceSubview goalId={goalSubviewId} />,
            }
          : null,
    },
  ];

export function resolveWorkspaceSidebarView(
  context: WorkspaceSidebarViewContext,
  registrations: readonly WorkspaceSidebarViewRegistration[] = [],
) {
  for (const registration of [
    ...registrations,
    ...WORKSPACE_SIDEBAR_VIEW_REGISTRY,
  ]) {
    const view = registration.resolve(context);
    if (view) return view;
  }
  return null;
}
