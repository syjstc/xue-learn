import {configureEnvSource,getEnv,getRuntimeEnvironment,hasProviderCredentials,resetEnvCache} from './env';
describe('host-owned provider environment',()=>{
  afterEach(()=>configureEnvSource(undefined));
  it('isolates host credentials and local feature flags without changing the process',()=>{
    const before=process.env.OPENAI_API_KEY;
    let values={OPENAI_API_KEY:'host-key',XUELEARN_DESKTOP_LOCAL:'1'};
    configureEnvSource(()=>values);
    expect(getEnv().OPENAI_API_KEY).toBe('host-key');
    expect(getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL).toBe('1');
    expect(hasProviderCredentials('codex')).toBe(true);
    expect(process.env.OPENAI_API_KEY).toBe(before);
    values={OPENAI_API_KEY:'new-key',XUELEARN_DESKTOP_LOCAL:'0'};resetEnvCache();
    expect(getEnv().OPENAI_API_KEY).toBe('new-key');
    expect(hasProviderCredentials('codex')).toBe(false);
  });
  it('returns snapshots that cannot mutate the host source',()=>{
    const values={OPENAI_API_KEY:'host-key'};configureEnvSource(()=>values);
    getRuntimeEnvironment().OPENAI_API_KEY='changed';
    expect(getRuntimeEnvironment().OPENAI_API_KEY).toBe('host-key');
  });
});
