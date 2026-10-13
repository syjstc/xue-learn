import {pluginProviderEnvironment} from './provider-environment';

test('unconfigured plugin providers leave optional URLs absent so consumers can apply defaults',()=>{
  const env=pluginProviderEnvironment({});
  expect(Object.values(env).every(value=>value.trim().length>0)).toBe(true);
  expect(env.CUSTOM_EMBEDDING_BASE_URL).toBeUndefined();
  expect(env.CUSTOM_OPENAI_BASE_URL).toBeUndefined();
  expect(env.DASHSCOPE_AUDIO_BASE_URL).toBeUndefined();
  expect(env.DASHSCOPE_BASE_URL).toBeUndefined();
});

test('configured provider credentials and endpoints survive without mutating process environment',()=>{
  const original={...process.env};
  const env=pluginProviderEnvironment({custom:{apiKey:'fixture-chat-key',baseUrl:'https://chat.example/v1'},
    custom_embedding:{apiKey:'fixture-embedding-key',baseUrl:'https://embedding.example/v1'}});
  expect(env).toMatchObject({CUSTOM_OPENAI_API_KEY:'fixture-chat-key',CUSTOM_OPENAI_BASE_URL:'https://chat.example/v1',
    CUSTOM_EMBEDDING_API_KEY:'fixture-embedding-key',CUSTOM_EMBEDDING_BASE_URL:'https://embedding.example/v1'});
  expect(process.env).toEqual(original);
});
