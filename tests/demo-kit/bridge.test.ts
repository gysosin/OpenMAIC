import { describe, expect, it } from 'vitest';

import { parseHostMessage } from '@/lib/demo-kit/core/bridge';

describe('parseHostMessage', () => {
  it('reads the step from the widget_setState payload or the top level', () => {
    expect(parseHostMessage({ type: 'SET_WIDGET_STATE', state: { step: 's2' }, content: 'x' })).toEqual({
      type: 'SET_WIDGET_STATE',
      step: 's2',
    });
    expect(parseHostMessage({ type: 'SET_WIDGET_STATE', step: 3 })).toEqual({ type: 'SET_WIDGET_STATE', step: 3 });
  });

  it('accepts only light and dark themes', () => {
    expect(parseHostMessage({ type: 'SET_THEME', theme: 'light' })).toEqual({ type: 'SET_THEME', theme: 'light' });
    expect(parseHostMessage({ type: 'SET_THEME', theme: 'sepia' })).toBeNull();
  });

  it.each([
    null,
    'SET_THEME',
    42,
    {},
    { type: 'HIGHLIGHT_ELEMENT', target: '#x' },
    { type: 'SET_WIDGET_STATE' },
    { type: 'SET_WIDGET_STATE', state: { step: '' } },
    { type: 'SET_WIDGET_STATE', state: { step: -1 } },
    { type: 'SET_WIDGET_STATE', state: { step: 1.5 } },
    { type: 'SET_WIDGET_STATE', state: { step: { id: 's1' } } },
    { type: 'SET_WIDGET_STATE', state: { step: 'x'.repeat(201) } },
  ])('rejects %j', (data) => {
    expect(parseHostMessage(data)).toBeNull();
  });
});
