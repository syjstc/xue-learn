import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DESKTOP_CSP} from '../security';

const html = readFileSync(join(__dirname, '../../../..', 'src/desktop-local/index.html'), 'utf8');
const metaPolicy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
const directives = (policy: string) => new Map(policy.split(';').map(value => {
  const [directive, ...sources] = value.trim().split(/\s+/);
  return [directive, sources];
}));

test('both enforced policies allow verified plugin scripts, styles and lesson media', () => {
  expect(metaPolicy).toBeDefined();
  for (const policy of [DESKTOP_CSP, metaPolicy!]) {
    const parsed = directives(policy);
    for (const directive of ['script-src', 'style-src', 'img-src', 'media-src', 'connect-src', 'font-src']) {
      expect(parsed.get(directive)).toContain('xuelearn-plugin:');
      expect(parsed.get(directive)).not.toContain('*');
      expect(parsed.get(directive)).not.toContain('https:');
    }
  }
});
