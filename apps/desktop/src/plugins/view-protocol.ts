import type { Session } from 'electron';
import type {DesktopPluginSurfaces} from './native-services';
import { DesktopPluginViews, PLUGIN_VIEW_SCHEME } from './views';

export const pluginViewScheme = {
  scheme: PLUGIN_VIEW_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false },
};

/** Only assets already verified and retained for an active view can be served. */
export function installPluginViewProtocol(session: Session, views: DesktopPluginViews, surfaces?: DesktopPluginSurfaces): void {
  session.protocol.handle(PLUGIN_VIEW_SCHEME, async request => {
    const surface = await surfaces?.response(request);
    if(surface)return surface;
    const asset = request.method === 'GET' ? await views.assetAsync(request.url) : undefined;
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(asset.body), { headers: {
      'Content-Type': asset.contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  });
}
