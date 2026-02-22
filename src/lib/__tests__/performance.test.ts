import { describe, it, expect } from 'vitest';
import {
  getVisibleRange,
  filterEntries,
  looksLikeQuestion,
  truncateForPreview,
} from '@/lib/performance-utils';

describe('VirtualList logic - getVisibleRange', () => {
  it('returns correct visible range for middle scroll position', () => {
    const result = getVisibleRange(1000, 600, 100, 50);

    // scrollTop=1000, containerHeight=600, itemHeight=100
    // visible items: index 10 to 15 (6 items fit in viewport)
    expect(result.start).toBeLessThanOrEqual(10);
    expect(result.end).toBeGreaterThanOrEqual(16);
    expect(result.totalHeight).toBe(5000); // 50 items * 100px
  });

  it('includes overscan buffer above and below viewport', () => {
    const result = getVisibleRange(1000, 600, 100, 50, 2);

    // With overscan=2, should render 2 items before and after visible range
    // Visible: 10-15, with buffer: 8-17
    expect(result.start).toBeLessThanOrEqual(8);
    expect(result.end).toBeGreaterThanOrEqual(17);
  });

  it('handles scroll at top (start of list)', () => {
    const result = getVisibleRange(0, 600, 100, 50, 2);

    expect(result.start).toBe(0); // Can't go below 0
    expect(result.end).toBeGreaterThanOrEqual(6); // 6 visible + overscan
    expect(result.totalHeight).toBe(5000);
  });

  it('handles scroll at bottom (end of list)', () => {
    const result = getVisibleRange(4400, 600, 100, 50, 2);

    // scrollTop=4400, last item starts at index 44
    // visible items: 44-49 (last 6 items)
    expect(result.start).toBeLessThanOrEqual(44);
    expect(result.end).toBe(50); // Can't go beyond totalItems
    expect(result.totalHeight).toBe(5000);
  });

  it('handles empty list', () => {
    const result = getVisibleRange(0, 600, 100, 0);

    expect(result.start).toBe(0);
    expect(result.end).toBe(0);
    expect(result.totalHeight).toBe(0);
  });

  it('handles single item', () => {
    const result = getVisibleRange(0, 600, 100, 1);

    expect(result.start).toBe(0);
    expect(result.end).toBe(1);
    expect(result.totalHeight).toBe(100);
  });

  it('calculates correct total height for any item count', () => {
    expect(getVisibleRange(0, 600, 150, 100).totalHeight).toBe(15000);
    expect(getVisibleRange(0, 600, 200, 25).totalHeight).toBe(5000);
  });

  it('uses default overscan of 3 when not specified', () => {
    const result = getVisibleRange(1000, 600, 100, 50);

    // Default overscan should be 3
    // Visible: 10-15, with buffer: 7-18
    expect(result.start).toBeLessThanOrEqual(7);
    expect(result.end).toBeGreaterThanOrEqual(18);
  });
});

describe('Memoized filtering - filterEntries', () => {
  const mockEntries = [
    {
      id: '1',
      timestamp: '2024-01-01T00:00:00Z',
      agentId: 'user',
      type: 'request',
      content: 'Test message 1',
    },
    {
      id: '2',
      timestamp: '2024-01-02T00:00:00Z',
      agentId: 'claude',
      type: 'response',
      content: 'Test message 2',
    },
    {
      id: '3',
      timestamp: '2024-01-03T00:00:00Z',
      agentId: 'architect',
      type: 'response',
      content: 'Test message 3',
    },
  ];

  it('returns same reference when inputs unchanged', () => {
    const result1 = filterEntries(mockEntries, 'all', 'all');
    const result2 = filterEntries(mockEntries, 'all', 'all');

    // Referential equality - same object in memory
    expect(result1).toBe(result2);
  });

  it('filters by agent correctly', () => {
    const result = filterEntries(mockEntries, 'claude', 'all');

    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('claude');
  });

  it('filters by type correctly', () => {
    const result = filterEntries(mockEntries, 'all', 'request');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('request');
  });

  it('filters by both agent and type', () => {
    const result = filterEntries(mockEntries, 'claude', 'response');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('returns all entries when filters are "all"', () => {
    const result = filterEntries(mockEntries, 'all', 'all');

    expect(result).toHaveLength(3);
  });

  it('returns empty array for no matches', () => {
    const result = filterEntries(mockEntries, 'nonexistent', 'all');

    expect(result).toHaveLength(0);
  });

  it('handles empty entries array', () => {
    const result = filterEntries([], 'all', 'all');

    expect(result).toHaveLength(0);
  });

  it('returns different reference when filter changes', () => {
    const result1 = filterEntries(mockEntries, 'all', 'all');
    const result2 = filterEntries(mockEntries, 'claude', 'all');

    // Different filters should return different references
    expect(result1).not.toBe(result2);
  });
});

describe('Question detection caching - looksLikeQuestion', () => {
  it('returns false for short messages', () => {
    expect(looksLikeQuestion('ok')).toBe(false);
    expect(looksLikeQuestion('yes')).toBe(false);
    expect(looksLikeQuestion('no')).toBe(false);
    expect(looksLikeQuestion('')).toBe(false);
    expect(looksLikeQuestion('a'.repeat(29))).toBe(false);
  });

  it('returns true for messages with question mark (30+ chars)', () => {
    expect(looksLikeQuestion('What is this and how does it work?')).toBe(true);
    expect(looksLikeQuestion('How does this work in production?')).toBe(true);
    expect(looksLikeQuestion('Is this correct implementation strategy?')).toBe(true);
  });

  it('returns true for Korean question patterns (30+ chars)', () => {
    expect(looksLikeQuestion('응답을 기다리고 있습니다. 확인 부탁드립니다. 알려주세요.')).toBe(true);
    expect(looksLikeQuestion('어떤 옵션이 좋을까요? 의견을 알려주세요. 확인해주세요.')).toBe(true);
    expect(looksLikeQuestion('결정이 필요합니다. 어떻게 해주시겠어요? 피드백 주세요.')).toBe(true);
  });

  it('returns false for completion/confirmation patterns', () => {
    expect(looksLikeQuestion('Task completed successfully')).toBe(false);
    expect(looksLikeQuestion('Done with the implementation')).toBe(false);
    expect(looksLikeQuestion('Finished the refactoring')).toBe(false);
    expect(looksLikeQuestion('Successfully deployed')).toBe(false);
  });

  it('returns false for orchestrator emoji prefixes', () => {
    expect(looksLikeQuestion('🎯 Planning the next steps')).toBe(false);
    expect(looksLikeQuestion('🤔 Analyzing the codebase')).toBe(false);
    expect(looksLikeQuestion('✅ Verification complete')).toBe(false);
    expect(looksLikeQuestion('🔍 Searching for patterns')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(looksLikeQuestion('a'.repeat(30))).toBe(false); // Exactly 30 chars, no question
    expect(looksLikeQuestion('a'.repeat(31) + '?')).toBe(true); // Over 30 with ?
    expect(looksLikeQuestion('   ?   ')).toBe(false); // Short with whitespace
  });

  it('is case insensitive for completion patterns', () => {
    expect(looksLikeQuestion('DONE WITH THE TASK')).toBe(false);
    expect(looksLikeQuestion('task COMPLETED successfully')).toBe(false);
  });

  it('returns true for long messages with question mark', () => {
    const longQuestion = 'This is a very long message that exceeds thirty characters and asks a question?';
    expect(looksLikeQuestion(longQuestion)).toBe(true);
  });

  it('returns false for long statements without question indicators', () => {
    const longStatement = 'This is a very long message that exceeds thirty characters but is not a question';
    expect(looksLikeQuestion(longStatement)).toBe(false);
  });
});

describe('Content truncation - truncateForPreview', () => {
  it('returns original string if shorter than maxLength', () => {
    expect(truncateForPreview('short', 100)).toBe('short');
    expect(truncateForPreview('exactly', 7)).toBe('exactly');
  });

  it('truncates and adds ellipsis if longer than maxLength', () => {
    const result = truncateForPreview('This is a very long message', 10);

    expect(result).toHaveLength(13); // 10 + '...'
    expect(result).toBe('This is a ...');
  });

  it('handles empty string', () => {
    expect(truncateForPreview('', 100)).toBe('');
  });

  it('handles maxLength of 0', () => {
    expect(truncateForPreview('anything', 0)).toBe('...');
  });

  it('preserves exact length when string equals maxLength', () => {
    expect(truncateForPreview('12345', 5)).toBe('12345');
  });

  it('truncates at word boundary when possible', () => {
    const result = truncateForPreview('The quick brown fox', 10);

    // Should try to break at space, not mid-word
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(13);
  });

  it('handles very short maxLength', () => {
    expect(truncateForPreview('Hello world', 3)).toBe('Hel...');
  });

  it('handles markdown content', () => {
    const markdown = '# Heading\n\nSome **bold** text with [links](url)';
    const result = truncateForPreview(markdown, 20);

    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(23);
  });

  it('handles special characters', () => {
    const special = 'Hello 👋 world 🌍';
    const result = truncateForPreview(special, 10);

    expect(result.endsWith('...')).toBe(true);
  });
});
