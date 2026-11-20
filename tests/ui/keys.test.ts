// The play screen's keyboard shortcuts.
import { describe, expect, it } from 'vitest';
import { keyCommand } from '../../src/ui/play';

describe('keyboard', () => {
  it('maps the keys', () => {
    expect(keyCommand({ key: 'e' })).toEqual({ t: 'end' });
    expect(keyCommand({ key: 'E' })).toEqual({ t: 'end' });
    expect(keyCommand({ key: 'a' })).toEqual({ t: 'attack' });
    expect(keyCommand({ key: 'Enter' })).toEqual({ t: 'confirm' });
    expect(keyCommand({ key: 'Escape' })).toEqual({ t: 'close' });
    expect(keyCommand({ key: '1' })).toEqual({ t: 'hand', index: 0 });
    expect(keyCommand({ key: '9' })).toEqual({ t: 'hand', index: 8 });
  });

  it('leaves other keys, shortcuts with modifiers and typing alone', () => {
    expect(keyCommand({ key: '0' })).toBeNull();
    expect(keyCommand({ key: 'x' })).toBeNull();
    expect(keyCommand({ key: 'e', ctrlKey: true })).toBeNull();
    expect(keyCommand({ key: 'a', metaKey: true })).toBeNull();
    expect(keyCommand({ key: 'e', typing: true })).toBeNull();
  });
});
