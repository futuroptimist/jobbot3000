import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/fetch.js', async () => {
  const actual = await vi.importActual('../src/fetch.js');
  return {
    ...actual,
    fetchTextFromUrl: vi.fn().mockResolvedValue(
      'Title: Example\nCompany: Example Corp\nRequirements\n- Build things',
    ),
  };
});

vi.mock('../src/jobs.js', () => ({
  jobIdFromSource: vi.fn().mockReturnValue('job-abc123'),
  saveJobSnapshot: vi.fn().mockResolvedValue('/tmp/job-abc123.json'),
}));

vi.mock('../src/exporters.js', () => ({
  toMarkdownSummary: vi.fn().mockReturnValue('## Summary\n\nBuild things'),
  toJson: vi.fn().mockReturnValue('{"summary":"Build things"}'),
  toDocxSummary: vi.fn().mockResolvedValue(Buffer.from('docx-summary')),
  toMarkdownMatch: vi.fn().mockReturnValue('## Match Report'),
  toMarkdownMatchExplanation: vi.fn().mockReturnValue('## Explanation'),
  toDocxMatch: vi.fn().mockResolvedValue(Buffer.from('docx-match')),
  formatMatchExplanation: vi.fn().mockReturnValue('explanation'),
}));

vi.mock('../src/parser.js', () => ({
  parseJobText: vi.fn().mockReturnValue({
    title: 'Example',
    company: 'Example Corp',
    requirements: ['Build things'],
  }),
}));

vi.mock('../src/index.js', () => ({
  summarize: vi.fn(),
  summarizeFirstSentence: vi.fn().mockReturnValue('Build things'),
}));

vi.mock('../src/resume.js', () => ({
  loadResume: vi.fn().mockResolvedValue('Resume text'),
}));

vi.mock('../src/scoring.js', () => ({
  computeFitScore: vi.fn().mockReturnValue({
    score: 82,
    matched: ['Build things'],
    missing: ['Ship faster'],
    must_haves_missed: [],
    keyword_overlap: [],
    evidence: [{ text: 'Build things', source: 'requirements' }],
  }),
}));

vi.mock('../src/url-ingest.js', () => ({
  ingestJobUrl: vi.fn().mockResolvedValue({ id: 'job-url-1' }),
}));

// Validates the documented `--max-bytes` CLI flag forwards limits to the HTTP helpers.
describe('CLI max-bytes forwarding', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes --max-bytes to summarize URL fetches', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { cmdSummarize } = await import('../bin/jobbot.js');
    const { fetchTextFromUrl } = await import('../src/fetch.js');

    await cmdSummarize(['http://example.com/posting', '--max-bytes', '4096']);

    expect(fetchTextFromUrl).toHaveBeenCalledWith('http://example.com/posting', {
      timeoutMs: 10000,
      headers: { 'User-Agent': 'jobbot3000' },
      maxBytes: 4096,
    });

    consoleSpy.mockRestore();
  });

  it('passes --max-bytes to match URL fetches', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { cmdMatch } = await import('../bin/jobbot.js');
    const { fetchTextFromUrl } = await import('../src/fetch.js');

    await cmdMatch([
      '--resume',
      'resume.txt',
      '--job',
      'http://example.com/posting',
      '--max-bytes',
      '8192',
    ]);

    expect(fetchTextFromUrl).toHaveBeenCalledWith('http://example.com/posting', {
      timeoutMs: 10000,
      headers: { 'User-Agent': 'jobbot3000' },
      maxBytes: 8192,
    });

    consoleSpy.mockRestore();
  });

  it('passes --max-bytes to ingest url command', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { cmdIngestUrl } = await import('../bin/jobbot.js');
    const { ingestJobUrl } = await import('../src/url-ingest.js');

    await cmdIngestUrl(['http://example.com/posting', '--max-bytes', '16384']);

    expect(ingestJobUrl).toHaveBeenCalledWith({
      url: 'http://example.com/posting',
      timeoutMs: 10000,
      maxBytes: 16384,
    });

    consoleSpy.mockRestore();
  });
});
