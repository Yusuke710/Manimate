import { describe, it, expect } from 'vitest';
import { parseNDJSONChunk } from '../ndjson-parser';

describe('parseNDJSONChunk', () => {
  it('parses a complete single line correctly', () => {
    const result = parseNDJSONChunk('', '{"type":"progress","message":"hello"}\n');

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual({ type: 'progress', message: 'hello' });
    expect(result.remainder).toBe('');
  });

  it('parses multiple complete lines correctly', () => {
    const chunk = '{"type":"progress","state":"planning"}\n{"type":"progress","state":"coding"}\n{"type":"complete","video_url":"/video.mp4"}\n';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toEqual({ type: 'progress', state: 'planning' });
    expect(result.lines[1]).toEqual({ type: 'progress', state: 'coding' });
    expect(result.lines[2]).toEqual({ type: 'complete', video_url: '/video.mp4' });
    expect(result.remainder).toBe('');
  });

  it('returns incomplete line at end as remainder', () => {
    const chunk = '{"type":"complete"}\n{"type":"incompleteL';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual({ type: 'complete' });
    expect(result.remainder).toBe('{"type":"incompleteL');
  });

  it('reassembles line split across two chunks correctly', () => {
    // First chunk: ends mid-JSON
    const result1 = parseNDJSONChunk('', '{"session_id":"abc');
    expect(result1.lines).toHaveLength(0);
    expect(result1.remainder).toBe('{"session_id":"abc');

    // Second chunk: completes the JSON line
    const result2 = parseNDJSONChunk(result1.remainder, '123","status":"ok"}\n');
    expect(result2.lines).toHaveLength(1);
    expect(result2.lines[0]).toEqual({ session_id: 'abc123', status: 'ok' });
    expect(result2.remainder).toBe('');
  });

  it('handles empty chunks gracefully', () => {
    const result = parseNDJSONChunk('', '');

    expect(result.lines).toHaveLength(0);
    expect(result.remainder).toBe('');
  });

  it('handles empty chunk with existing buffer', () => {
    const result = parseNDJSONChunk('{"partial":"data', '');

    expect(result.lines).toHaveLength(0);
    expect(result.remainder).toBe('{"partial":"data');
  });

  it('skips invalid JSON lines without throwing', () => {
    const chunk = '{"valid":"json"}\nnot valid json at all\n{"also":"valid"}\n';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toEqual({ valid: 'json' });
    expect(result.lines[1]).toEqual({ also: 'valid' });
    expect(result.remainder).toBe('');
  });

  it('skips empty lines between valid JSON', () => {
    const chunk = '{"first":"obj"}\n\n\n{"second":"obj"}\n';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toEqual({ first: 'obj' });
    expect(result.lines[1]).toEqual({ second: 'obj' });
  });

  it('handles lines with whitespace around them', () => {
    const chunk = '  {"type":"test"}  \n';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual({ type: 'test' });
  });

  it('handles complex multi-chunk scenario', () => {
    // Simulate realistic TCP chunking with session_id appearing mid-stream
    let buffer = '';

    // Chunk 1: Complete line + start of next
    const result1 = parseNDJSONChunk(buffer, '{"type":"init"}\n{"session');
    buffer = result1.remainder;
    expect(result1.lines).toHaveLength(1);
    expect(result1.lines[0]).toEqual({ type: 'init' });
    expect(buffer).toBe('{"session');

    // Chunk 2: Continue session_id line + another partial
    const result2 = parseNDJSONChunk(buffer, '_id":"ses-123"}\n{"type":"pro');
    buffer = result2.remainder;
    expect(result2.lines).toHaveLength(1);
    expect(result2.lines[0]).toEqual({ session_id: 'ses-123' });
    expect(buffer).toBe('{"type":"pro');

    // Chunk 3: Complete the final line
    const result3 = parseNDJSONChunk(buffer, 'gress"}\n');
    buffer = result3.remainder;
    expect(result3.lines).toHaveLength(1);
    expect(result3.lines[0]).toEqual({ type: 'progress' });
    expect(buffer).toBe('');
  });

  it('skips JSON primitive values (only objects and arrays)', () => {
    const chunk = '"just a string"\n42\ntrue\nnull\n{"valid":"object"}\n[1,2,3]\n';
    const result = parseNDJSONChunk('', chunk);

    // Should only include objects and arrays, not primitives
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toEqual({ valid: 'object' });
    expect(result.lines[1]).toEqual([1, 2, 3]);
  });

  it('handles chunk with only newlines', () => {
    const result = parseNDJSONChunk('', '\n\n\n');

    expect(result.lines).toHaveLength(0);
    expect(result.remainder).toBe('');
  });

  it('handles buffer with newlines joining to complete a line', () => {
    // Buffer ends without newline, chunk starts with newline
    const result = parseNDJSONChunk('{"test":"value"}', '\n{"next":"line"}\n');

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toEqual({ test: 'value' });
    expect(result.lines[1]).toEqual({ next: 'line' });
    expect(result.remainder).toBe('');
  });

  it('handles CRLF line endings (Windows-style)', () => {
    const chunk = '{"type":"first"}\r\n{"type":"second"}\r\n';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toEqual({ type: 'first' });
    expect(result.lines[1]).toEqual({ type: 'second' });
    expect(result.remainder).toBe('');
  });

  it('handles mixed LF and CRLF line endings', () => {
    const chunk = '{"a":1}\n{"b":2}\r\n{"c":3}\n';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toEqual({ a: 1 });
    expect(result.lines[1]).toEqual({ b: 2 });
    expect(result.lines[2]).toEqual({ c: 3 });
  });

  it('handles CRLF split across chunks', () => {
    // First chunk ends with CR, second chunk starts with LF
    const result1 = parseNDJSONChunk('', '{"type":"test"}\r');
    expect(result1.lines).toHaveLength(0);
    expect(result1.remainder).toBe('{"type":"test"}\r');

    // Second chunk completes the CRLF
    const result2 = parseNDJSONChunk(result1.remainder, '\n{"next":"obj"}\n');
    expect(result2.lines).toHaveLength(2);
    expect(result2.lines[0]).toEqual({ type: 'test' });
    expect(result2.lines[1]).toEqual({ next: 'obj' });
    expect(result2.remainder).toBe('');
  });

  it('returns final line without trailing newline as remainder', () => {
    // This tests the scenario where the stream ends without a trailing newline
    // The remainder should contain the complete JSON that can be flushed manually
    const chunk = '{"complete":"line"}\n{"final":"noNewline"}';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual({ complete: 'line' });
    expect(result.remainder).toBe('{"final":"noNewline"}');

    // Verify the remainder is valid JSON that can be parsed during flush
    const flushed = JSON.parse(result.remainder);
    expect(flushed).toEqual({ final: 'noNewline' });
  });

  it('handles session_id in final line without newline (flush scenario)', () => {
    // Simulates the case where Claude outputs session_id as the last line without newline
    const chunk = '{"type":"init"}\n{"session_id":"ses-abc123"}';
    const result = parseNDJSONChunk('', chunk);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual({ type: 'init' });
    expect(result.remainder).toBe('{"session_id":"ses-abc123"}');

    // The route.ts flush logic should be able to parse this
    const flushedData = JSON.parse(result.remainder);
    expect(flushedData.session_id).toBe('ses-abc123');
  });
});
