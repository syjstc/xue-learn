import { createMaterialGenerationJitItemsSchema } from '../llm/jit-structured-items.js';
import { strictLearningMaterialSchema } from '../llm/schemas.js';
import { parseFlattenedMaterialItems } from './section-material-envelope.js';

const policy = { allowedComponentTypes: [], maxComponentCount: 0, allowIllustrations: true };
const schema = createMaterialGenerationJitItemsSchema({ policy });
const section = Array.from({ length: 8 }, (_, topic) => [
  { kind: 'block', block: { type: 'heading', level: 2, text: `主题 ${topic + 1}` } },
  ...Array.from({ length: 18 }, (_, beat) => ({
    kind: 'block', block: { type: 'paragraph', text: `主题 ${topic + 1} 的第 ${beat + 1} 段讲解。` },
  })),
]).flat();

test('preserves a full eight-topic section with more than 132 accepted narration items', () => {
  const parsed = parseFlattenedMaterialItems(section, schema, true);
  expect(parsed).toEqual(section);
  expect(parsed).toHaveLength(152);
  const blocks = parsed.flatMap((item) => item.kind === 'block' ? [item.block] : []);
  const material = strictLearningMaterialSchema.parse({ introduction: '', blocks, keyTakeaways: [] });
  expect(material.blocks).toHaveLength(152);
  expect(material.blocks.at(-1)).toEqual(section.at(-1)?.block);
});

test('the section budget still rejects excessive material rather than truncating it', () => {
  const tooMany = Array.from({ length: 257 }, (_, i) => ({
    kind: 'block', block: { type: 'paragraph', text: `讲解 ${i + 1}。` },
  }));
  expect(() => parseFlattenedMaterialItems(tooMany, schema, true)).toThrow();
  expect(() => strictLearningMaterialSchema.parse({ introduction: '', blocks: tooMany.map((item) => item.block), keyTakeaways: [] })).toThrow();
});
