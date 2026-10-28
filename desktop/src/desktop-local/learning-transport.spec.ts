jest.mock("@xue-learn/core/i18n",()=>({getCurrentUiLocale:()=> 'en'}));
let connected=true;
jest.mock("@xue-learn/core/client-runtime",()=>({isDesktopLocalRuntime:()=>connected}));
import {apiFetch,apiUrl} from "./learning-api-client.ts";
import {getAuthUser,getAuthToken} from "./learning-identity.ts";
import {LOCAL_OWNER_ID} from "@xue-learn/core/runtime-contracts";
afterEach(()=>{connected=true;jest.restoreAllMocks();});
it('preserves the exact desktop owner and never reads hosted token storage',()=>{expect(getAuthUser()?.id).toBe(LOCAL_OWNER_ID);expect(getAuthToken()).toBeNull();});
it('preserves local same-origin headers/cache policy and makes one request',async()=>{
 const request=jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
 await apiFetch('/api/goals');expect(apiUrl('api/goals')).toBe('/api/goals');expect(request).toHaveBeenCalledTimes(1);
 const [url,init]=request.mock.calls[0];expect(url).toBe('/api/goals');expect(new Headers(init?.headers).get('Accept-Language')).toBe('en');expect(new Headers(init?.headers).has('Authorization')).toBe(false);expect(init?.cache).toBe('no-store');expect(init?.credentials).toBe('omit');
});
it('does not make a local request before the owning desktop runtime connects',async()=>{connected=false;const request=jest.spyOn(globalThis,'fetch');await expect(apiFetch('/api/goals')).rejects.toThrow('must be connected');expect(request).not.toHaveBeenCalled();expect(getAuthUser()).toBeNull();});
