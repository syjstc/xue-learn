import {createBaseGenerationCapability} from "../learning-systems/capabilities/base";
import {configureGenerationContextResolver, prepareGenerationInvocation, runGenerationContextScope} from './kernel';
import {createGenerationContextResolver, createLearningSystemRuntime} from '../learning-systems/runtime';
import {createTeachingDerivationCapability} from '../learning-systems/capabilities/teaching-derivation/capability';
import {UNIT_TEACHING_DERIVATION_OPERATION, TEACHING_DERIVATION_TOOL_SET} from '../learning-systems/capabilities/teaching-derivation/keys';

afterEach(() => configureGenerationContextResolver(undefined));
test('independent derivation runtime supplies tools and full policy without learner persistence or changing host resolver', async () => {
  const host = jest.fn(async () => ({contributions: []}));
  configureGenerationContextResolver(host);
  const runtime = createLearningSystemRuntime({capabilities: [createBaseGenerationCapability(), createTeachingDerivationCapability()]});
  expect(runtime.registry.getToolSet(TEACHING_DERIVATION_TOOL_SET)).toBeDefined();
  const result = await runGenerationContextScope({subject: {userId: 'video-owner', threadId: 'run'}}, () =>
    prepareGenerationInvocation(UNIT_TEACHING_DERIVATION_OPERATION, '', createGenerationContextResolver(runtime)));
  expect(result.prompt).toContain('commit_teaching_step');
  expect(result.contextMeta.generationContextApplied).toBe(true);
  expect(host).not.toHaveBeenCalled();
  await prepareGenerationInvocation(UNIT_TEACHING_DERIVATION_OPERATION, 'host');
  expect(host).toHaveBeenCalledTimes(1);
});
