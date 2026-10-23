import { timelineKindLabel } from '../features/history/timeline-kinds';
import { formatBytes, paragraphs } from './archive-format';

describe('archive formatting', () => {
  it('formats file sizes for people', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5.25 * 1024 * 1024)).toBe('5.3 MB');
  });

  it('splits stories into paragraphs at blank lines, keeping line breaks inside them', () => {
    expect(paragraphs('First line\nsame paragraph\n\n  \nSecond\n\n')).toEqual(['First line\nsame paragraph', 'Second']);
    expect(paragraphs('')).toEqual([]);
  });

  it('labels timeline lines by where they come from', () => {
    expect(timelineKindLabel({ source: 'event', kind: 'migration' })).toBe('Migration');
    expect(timelineKindLabel({ source: 'record', kind: 'birth' })).toBe('Birth');
    expect(timelineKindLabel({ source: 'story', kind: 'oral_history' })).toBe('Oral history');
    expect(timelineKindLabel({ source: 'story', kind: 'tradition' })).toBe('Tradition');
    expect(timelineKindLabel({ source: 'event', kind: 'tradition' })).toBe('Tradition / ceremony');
  });
});
