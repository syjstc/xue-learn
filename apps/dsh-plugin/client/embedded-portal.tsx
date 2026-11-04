import {createContext} from 'react';

// Keep Base UI portals inside the plugin's containing block and scoped theme.
export const EmbeddedPortalContext = createContext<HTMLElement | null>(null);
