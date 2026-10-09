import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

const DesktopTitlebarTargetContext = createContext<HTMLElement | null>(null);

export function DesktopTitlebarTargetProvider({
  children,
  target,
}: {
  children: ReactNode;
  target: HTMLElement | null;
}) {
  return (
    <DesktopTitlebarTargetContext.Provider value={target}>
      {children}
    </DesktopTitlebarTargetContext.Provider>
  );
}

export function DesktopTitlebarPortal({ children }: { children: ReactNode }) {
  const target = useContext(DesktopTitlebarTargetContext);
  return target ? createPortal(children, target) : null;
}
