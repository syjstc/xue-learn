import type {ReactNode} from 'react';
// Electron's plugin registry is owned by the standalone host, not by DSH.
export function DesktopPluginSlot() {return null;}
export function DesktopPluginUiProvider({children}: {children: ReactNode}) {return children;}
export function useDesktopPluginUi() {return {entries: [], ready: true};}
export const pluginUiIcons = {};
export function DesktopPluginView() {return null;}
export function LocalPluginViewPage() {return null;}
