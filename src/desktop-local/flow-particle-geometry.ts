/** Compare the head of each current Comet inside its stable semantic carrier. */
export function flowParticleGeometry(html: string) {
  return [...html.matchAll(/data-flow-particle="([^"]+)"[^>]*><g[^>]*>(.*?)<\/g><\/g>/g)].map(match=>{
    const circles=[...match[2]!.matchAll(/<circle\s[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"/g)];
    const head=circles.at(-1);
    if(!head)throw Error(`Flow carrier ${match[1]} has no Comet head geometry`);
    return [match[1],head[1],head[2]];
  });
}
