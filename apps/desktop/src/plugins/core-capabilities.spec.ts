import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { DesktopHostCapabilities } from './host-capabilities';
import { registerCorePluginCapabilities } from './core-capabilities';

describe('Core host capability adapters', () => {
  let host: DesktopHostCapabilities;
  let Host: typeof import('./host-capabilities').DesktopHostCapabilities;
  let temporary: string;
  const controller = () => new AbortController();
  const context = (signal = controller().signal) => ({ pluginId: 'example.studio', workspaceId: 'workspace-selected', signal });
  const getSession = jest.fn(async (_workspaceId: string, _signal: AbortSignal) => ({ baseUrl: 'http://127.0.0.1:41001', token: 'private-host-token' }));
  const request = jest.fn(async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => new Response(JSON.stringify({ content: 'owned result' }), { status: 200 }));
  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'plugin-core-capabilities-'));
    const bundled = join(temporary, 'host.cjs');
    await build({ entryPoints: [join(__dirname, 'host-capabilities.ts')], outfile: bundled, bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'silent' });
    Host = require(bundled).DesktopHostCapabilities;
  });
  afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });
  beforeEach(() => { host = new Host(); getSession.mockClear(); request.mockClear(); });
  afterEach(async () => { await host.dispose(); });
  const register = (timeoutMs?: number) => registerCorePluginCapabilities(host, { getSession, request: request as typeof fetch, timeoutMs });

  it('uses the selected host session and exposes only the domain result', async () => {
    const dispose = await register();
    expect(host.versions).toEqual({ 'workspace.courses': 1, 'display.workspace': 1, 'generation.settings': 1, 'learning.preview': 1, 'learning.content': 1 });
    const result = await host.invoke('workspace.courses', 'catalog', undefined, context());
    expect(result).toEqual({ content: 'owned result' });
    expect(getSession).toHaveBeenCalledWith('workspace-selected', expect.any(AbortSignal));
    expect(request).toHaveBeenCalledWith('http://127.0.0.1:41001/api/course-sources/catalog', expect.objectContaining({
      method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer private-host-token' },
    }));
    await dispose();
    expect(host.versions).toEqual({});
  });

  it.each([
    ['workspace.courses', 'readUnit', { unitId: 'unit-1' }, '/api/course-sources/units/unit-1', 'GET', undefined],
    ['learning.content', 'read', {unitId: 'unit-1'}, '/api/course-sources/units/unit-1/teaching', 'GET', undefined],
    ['learning.content', 'ensure', {unitId: 'unit-1', locale: 'en'}, '/api/course-sources/units/unit-1/teaching/ensure', 'POST', {}],
    ['generation.settings', 'get', {}, '/api/local/generation-settings', 'GET', undefined],
    ['generation.settings', 'updateGlobal', {patch: {imageProvider: 'minimax'}}, '/api/local/generation-settings/global', 'PATCH', {patch: {imageProvider: 'minimax'}}],
    ['generation.settings', 'updateUser', {patch: {chatModel: 'host-model'}}, '/api/local/generation-settings/user', 'PATCH', {patch: {chatModel: 'host-model'}}],
    ['display.workspace', 'plugins', {}, '/api/local/display-plugins', 'GET', undefined],
    ['display.workspace', 'resolveDocument', { document: { version: 1, id: 'doc' } }, '/api/local/display-builds/resolve', 'POST', { document: { version: 1, id: 'doc' } }],
    ['display.workspace', 'getBuild', { id: 'build-1' }, '/api/local/display-builds/build-1', 'GET', undefined],
    ['display.workspace', 'retryBuild', { id: 'build-1' }, '/api/local/display-builds/build-1/retry', 'POST', {}],
    ['display.workspace', 'cancelBuild', { id: 'build-1' }, '/api/local/display-builds/build-1/cancel', 'POST', {}],
  ])('routes %s.%s to its owning controller', async (capability, method, args, path, verb, body) => {
    await register();
    await host.invoke(capability as string, method as string, args, context());
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:41001' + path);
    expect(init?.method).toBe(verb);
    expect(init?.body).toBe(body === undefined ? undefined : JSON.stringify(body));
  });

  it.each([
    ['learning.preview', 'ensure', {unitId: 'u', onlyIfMissing: false}],
    ['learning.preview', 'ensure', {unitId: 'u', locale: 'invalid'}],
    ['learning.preview', 'ensure', {unitId: '../settings'}],
    ['learning.content', 'ensure', {unitId: 'u', force: true}],
    ['learning.content', 'ensure', {unitId: 'u', userId: 'forged'}],
    ['learning.content', 'ensure', {unitId: 'u', locale: 'invalid'}],
    ['workspace.courses', 'catalog', { workspaceId: 'forged' }],
    ['workspace.courses', 'readUnit', { unitId: 'u', ownerId: 'forged' }],
    ['workspace.courses', 'readUnit', { unitId: '../settings' }],
    ['workspace.courses', 'readUnit', { unitId: '..' }],
    ['workspace.courses', 'readAsset', {unitId: 'u', resourceId: '../private', sha256: 'a'.repeat(64)}],
    ['workspace.courses', 'readAsset', {unitId: 'u', resourceId: 'asset', sha256: 'invalid'}],
    ['generation.settings', 'get', {ownerId: 'forged'}],
    ['generation.settings', 'updateUser', {patch: {}, workspaceId: 'forged'}],
    ['generation.settings', 'updateGlobal', {patch: []}],
    ['display.workspace', 'getBuild', { id: 'u', url: 'https://example.com' }],
    ['display.workspace', 'retryBuild', { id: 'u', token: 'forged' }],
    ['display.workspace', 'resolveDocument', { document: {}, session: {} }],
    ['display.workspace', 'resolveDocument', { document: null }],
  ])('rejects authority overrides and malformed arguments for %s.%s', async (capability, method, args) => {
    await register();
    await expect(host.invoke(capability as string, method as string, args, context())).rejects.toThrow('Invalid');
    expect(getSession).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('encodes URL punctuation as resource data and cannot redirect bearer credentials', async () => {
    await register();
    await host.invoke('workspace.courses', 'readUnit', { unitId: 'a?owner=other#x' }, context());
    expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:41001/api/course-sources/units/a%3Fowner%3Dother%23x');
    getSession.mockResolvedValueOnce({ baseUrl: 'https://example.com', token: 'private-host-token' });
    await expect(host.invoke('workspace.courses', 'catalog', undefined, context())).rejects.toThrow('Invalid host workspace session');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('returns null for missing reads and keeps mutation failures visible', async () => {
    await register();
    request.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(host.invoke('workspace.courses', 'readUnit', { unitId: 'missing' }, context())).resolves.toBeNull();
    request.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(host.invoke('display.workspace', 'getBuild', { id: 'missing' }, context())).resolves.toBeNull();
    request.mockResolvedValueOnce(new Response('{"token":"must-not-leak"}', { status: 423 }));
    await expect(host.invoke('display.workspace', 'retryBuild', { id: 'locked' }, context())).rejects.toThrow('Host workspace operation failed (423)');
  });

  it('returns course asset bytes without exporting the host session', async () => {
    await register();
    request.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 255]), {status: 200, headers: {'Content-Type': 'image/png'}}));
    const result = await host.invoke('workspace.courses', 'readAsset', {unitId: 'unit', resourceId: 'image', sha256: 'a'.repeat(64)}, context());
    expect(result).toEqual({data: new Uint8Array([1, 2, 255]), mediaType: 'image/png'});
    expect(request.mock.calls[0]![0]).toBe(`http://127.0.0.1:41001/api/course-sources/units/unit/assets/image?sha256=${'a'.repeat(64)}`);
  });

  it('cancels in-flight HTTP work when its invocation ends', async () => {
    await register();
    const abort = controller();
    request.mockImplementationOnce(async () => new Promise<Response>(() => {}));
    const result = host.invoke('workspace.courses', 'catalog', undefined, context(abort.signal));
    await new Promise<void>(resolve => setImmediate(resolve));
    const signal = request.mock.calls[0]![1]!.signal!;
    abort.abort(new Error('Plugin command ended'));
    await expect(result).rejects.toThrow('Plugin command ended');
    expect(signal.aborted).toBe(true);
  });

  it('times out session acquisition and never starts an HTTP request after cancellation', async () => {
    await register(5);
    let release!: (value: { baseUrl: string; token: string }) => void;
    getSession.mockImplementationOnce(async () => new Promise(resolve => { release = resolve; }));
    await expect(host.invoke('workspace.courses', 'catalog', undefined, context())).rejects.toThrow('timed out');
    expect(getSession.mock.calls[0]![1].aborted).toBe(true);
    release({ baseUrl: 'http://127.0.0.1:41001', token: 'private-host-token' });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(request).not.toHaveBeenCalled();
  });

  it('does not acquire a session for an already cancelled invocation', async () => {
    await register();
    const abort = controller(); abort.abort(new Error('Plugin disabled'));
    await expect(host.invoke('workspace.courses', 'catalog', undefined, context(abort.signal))).rejects.toThrow('Plugin disabled');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('ensures only the selected unit preview through the owner controller and waits for saved completion', async () => {
    await register();
    request.mockResolvedValueOnce(new Response('data: {"type":"sq_partial"}\n\ndata: {"type":"done"}\n\n', {headers: {'content-type': 'text/event-stream'}}));
    await expect(host.invoke('learning.preview', 'ensure', {unitId: 'unit-1', locale: 'en'}, context())).resolves.toEqual({complete: true});
    expect(request).toHaveBeenCalledWith('http://127.0.0.1:41001/api/units/unit-1/session/stream', expect.objectContaining({
      method: 'POST', redirect: 'error', body: JSON.stringify({action: 'generate_sq', onlyIfMissing: true}),
      headers: expect.objectContaining({Accept: 'text/event-stream', 'Accept-Language': 'en'}),
    }));
  });

  it('reads UTF-8 and CRLF preview completion across transport chunks', async () => {
    await register();
    const bytes = new TextEncoder().encode(': keepalive\r\n\r\ndata: {"type":"sq_partial","text":"正在预习"}\r\n\r\ndata: {"type":"done"}\r\n\r\n');
    const stream = new ReadableStream({start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    }});
    request.mockResolvedValueOnce(new Response(stream, {headers: {'content-type': 'text/event-stream'}}));
    await expect(host.invoke('learning.preview', 'ensure', {unitId: 'unit'}, context())).resolves.toEqual({complete: true});
  });

  it('cancels an unfinished preview stream when the plugin binding is closed', async () => {
    await register();
    const cancel = jest.fn(), abort = controller();
    request.mockResolvedValueOnce(new Response(new ReadableStream({cancel}), {headers: {'content-type': 'text/event-stream'}}));
    const result = host.invoke('learning.preview', 'ensure', {unitId: 'unit'}, context(abort.signal));
    await new Promise<void>(resolve => setImmediate(resolve));
    abort.abort(new Error('Plugin disabled'));
    await expect(result).rejects.toThrow('Plugin disabled');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    [409, 'application/json', '{"message":"已有正文但教学结构不完整，请先在课程内修复"}', '已有正文', 409],
    [200, 'text/event-stream', 'data: {"type":"error","message":"模型执行失败"}\n\ndata: {"type":"done"}\n\n', '模型执行失败', 400],
    [200, 'text/event-stream', 'data: {"type":"sq_partial"}\n\n', '响应中断', 503],
    [429, 'application/json', '{"message":"Too Many Requests"}', 'Too Many Requests', 429],
  ])('preserves preview failure or interruption status %s', async (status, type, body, message, expected) => {
    await register();
    request.mockResolvedValueOnce(new Response(body as string, {status: status as number, headers: {'content-type': type as string}}));
    const result = host.invoke('learning.preview', 'ensure', {unitId: 'unit'}, context());
    await expect(result).rejects.toThrow(message as string);
    await expect(result).rejects.toMatchObject({getStatus: expect.any(Function)});
    expect(await result.catch(error => error.getStatus())).toBe(expected);
  });
});
