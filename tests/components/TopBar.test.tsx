import { describe, expect, it } from 'vitest';
import {
  getShortcutAction,
  shouldIgnoreGlobalShortcutTarget,
} from '../../src/render/components/Navbar/TopBar';

describe('TopBar shortcut helpers', () => {
  it('should resolve supported global shortcuts', () => {
    expect(
      getShortcutAction({
        key: 'n',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBe('new-file');
    expect(
      getShortcutAction({
        key: 'O',
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
      })
    ).toBe('open-file');
    expect(
      getShortcutAction({
        key: 'z',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBe('undo');
    expect(
      getShortcutAction({
        key: 'Z',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      })
    ).toBe('redo');
    expect(
      getShortcutAction({
        key: 'y',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBe('redo');
  });

  it('should ignore unsupported or modified shortcuts', () => {
    expect(
      getShortcutAction({
        key: 's',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBeNull();
    expect(
      getShortcutAction({
        key: 'n',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBeNull();
    expect(
      getShortcutAction({
        key: 'o',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
      })
    ).toBeNull();
  });

  it('should skip native text inputs for global shortcuts', () => {
    expect(shouldIgnoreGlobalShortcutTarget(document.createElement('input'))).toBe(true);
    expect(shouldIgnoreGlobalShortcutTarget(document.createElement('textarea'))).toBe(true);
    expect(shouldIgnoreGlobalShortcutTarget(document.createElement('select'))).toBe(true);

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(shouldIgnoreGlobalShortcutTarget(editable)).toBe(true);

    expect(shouldIgnoreGlobalShortcutTarget(document.createElement('button'))).toBe(false);
    expect(shouldIgnoreGlobalShortcutTarget(null)).toBe(false);
  });
});
