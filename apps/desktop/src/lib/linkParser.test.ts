import { describe, it, expect } from 'vitest';
import { findLinkAtOffset, segmentInlineText } from './linkParser';

describe('findLinkAtOffset', () => {
  it('should find simple wikilinks', () => {
    const text = "Here is a [[Page]] link.";
    expect(findLinkAtOffset(text, 9)).toEqual(null); // before (space)
    expect(findLinkAtOffset(text, 10)).toEqual({ type: 'wiki', target: 'Page' }); // at '['
    expect(findLinkAtOffset(text, 15)).toEqual({ type: 'wiki', target: 'Page' }); // inside 'Page'
    expect(findLinkAtOffset(text, 18)).toEqual({ type: 'wiki', target: 'Page' }); // at end of ']]'
    expect(findLinkAtOffset(text, 19)).toEqual(null); // after (l)
  });

  it('should parse wikilinks with alias and header', () => {
    const text = "Go to [[Page#Section|Alias]] here.";
    expect(findLinkAtOffset(text, 15)).toEqual({ type: 'wiki', target: 'Page' });
  });

  it('should find standard markdown links', () => {
    const text = "Check out [Google](https://google.com) today.";
    expect(findLinkAtOffset(text, 9)).toEqual(null);
    expect(findLinkAtOffset(text, 15)).toEqual({ type: 'markdown', text: 'Google', target: 'https://google.com' });
    expect(findLinkAtOffset(text, 35)).toEqual({ type: 'markdown', text: 'Google', target: 'https://google.com' });
    expect(findLinkAtOffset(text, 39)).toEqual(null);
  });

  it('should find raw urls', () => {
    const text = "Visit https://example.com for more info.";
    expect(findLinkAtOffset(text, 15)).toEqual({ type: 'url', target: 'https://example.com' });
    expect(findLinkAtOffset(text, 5)).toEqual(null);
  });
});

describe('segmentInlineText', () => {
  it('returns one text segment for plain text', () => {
    expect(segmentInlineText('nur Text ohne Links')).toEqual([{ type: 'text', text: 'nur Text ohne Links' }]);
  });

  it('splits wikilinks embedded in text and keeps the surrounding text', () => {
    expect(segmentInlineText('Plan steht ([[Master_Projektplan]]). Weiter.')).toEqual([
      { type: 'text', text: 'Plan steht (' },
      { type: 'wiki', target: 'Master_Projektplan', display: 'Master_Projektplan' },
      { type: 'text', text: '). Weiter.' },
    ]);
  });

  it('handles alias and anchor in wikilinks', () => {
    expect(segmentInlineText('[[Seite#Abschnitt|Anzeige]]')).toEqual([
      { type: 'wiki', target: 'Seite', display: 'Anzeige' },
    ]);
  });

  it('splits markdown links and bare urls', () => {
    expect(segmentInlineText('Siehe [Doku](https://example.com) oder https://plainva.dev jetzt')).toEqual([
      { type: 'text', text: 'Siehe ' },
      { type: 'markdown', target: 'https://example.com', text: 'Doku' },
      { type: 'text', text: ' oder ' },
      { type: 'url', target: 'https://plainva.dev' },
      { type: 'text', text: ' jetzt' },
    ]);
  });

  it('treats vault-relative markdown links as segments too', () => {
    expect(segmentInlineText('[Notiz](Ordner/Notiz.md)')).toEqual([
      { type: 'markdown', target: 'Ordner/Notiz.md', text: 'Notiz' },
    ]);
  });
});
