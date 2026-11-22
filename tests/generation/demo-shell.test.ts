import { describe, expect, test } from 'vitest';

import { buildDemoShell, validateDemoSpec } from '@openmaic/generation';

const hostile = '</script><script>alert(1)</script>  <!--&';

const make = (s: string) => {
  const r = validateDemoSpec({
    version: 1,
    kind: 'scene3d',
    title: s,
    objects: [{ id: 'a', type: 'box', label: s, ask: s }],
    steps: [{ id: 's1', caption: s }],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

describe('buildDemoShell', () => {
  test('embeds spec block and kit script', () => {
    const html = buildDemoShell(make('Half adder'), {
      kitUrl: '/vendor/interactive/demo-kit@1/demo-kit.js',
      title: 'Half adder',
      lang: 'en',
    });
    expect(html).toContain('<script type="application/json" id="demo-spec">');
    expect(html).toContain('<script src="/vendor/interactive/demo-kit@1/demo-kit.js"></script>');
    expect(html).toContain('<html lang="en">');
  });

  test('hostile strings stay inert and round-trip', () => {
    const spec = make(hostile);
    const html = buildDemoShell(spec, {
      kitUrl: '/k.js"><script>x</script>',
      title: hostile,
      lang: 'en"><b>',
    });
    // only the spec block and the kit tag are scripts
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain(' ');
    expect(html).not.toContain(' ');
    const json = html.match(/id="demo-spec">([\s\S]*?)<\/script>/)![1];
    expect(json).not.toMatch(/[<>&]/);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(spec)));
    expect(JSON.parse(json).title).toBe(hostile);
    expect(html).toContain('<title>&lt;/script&gt;');
  });
});
