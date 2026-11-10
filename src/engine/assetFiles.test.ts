import { describe, expect, it } from 'vitest';
import { fileNameFor, uniqueNames } from './assetFiles';

describe('picture files', () => {
  it('get the extension their type calls for', () => {
    expect(fileNameFor('Pink Floyd - DSOTM (Fronte).jpg', 'image/jpeg')).toBe('Pink Floyd - DSOTM (Fronte).jpg');
    expect(fileNameFor('foto.jpeg', 'image/jpeg')).toBe('foto.jpeg');
    expect(fileNameFor('cover', 'image/png')).toBe('cover.png');
    expect(fileNameFor('cover.jpg', 'image/webp')).toBe('cover.webp');
    expect(fileNameFor('a/b:c?.png', 'image/png')).toBe('a_b_c_.png');
    expect(fileNameFor('  ', 'image/png')).toBe('image.png');
    expect(fileNameFor('notes.txt', '')).toBe('notes.txt');
  });

  it('are named once per folder', () => {
    expect(uniqueNames(['a.jpg', 'b.jpg', 'A.jpg', 'a.jpg', 'c'])).toEqual(['a.jpg', 'b.jpg', 'A (2).jpg', 'a (3).jpg', 'c']);
  });
});
