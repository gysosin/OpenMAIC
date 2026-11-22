import type { DemoSpec } from './demo-spec.js';

const HTML_ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '\u2028': '&#8232;',
  '\u2029': '&#8233;',
};
const esc = (s: string) => s.replace(/[&<>"'\u2028\u2029]/g, (c) => HTML_ESC[c]);

/** JSON for a <script type="application/json"> block: no raw <, >, &, U+2028/9 can appear. */
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(
    /[<>&\u2028\u2029]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );

/** Fixed HTML shell for a demo scene: the spec as inert JSON plus the vetted kit script. */
export function buildDemoShell(
  spec: DemoSpec,
  opts: { kitUrl: string; title: string; lang: string },
): string {
  return `<!DOCTYPE html>
<html lang="${esc(opts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}</style>
</head>
<body>
<script type="application/json" id="demo-spec">${safeJson(spec)}</script>
<script src="${esc(opts.kitUrl)}"></script>
</body>
</html>
`;
}
