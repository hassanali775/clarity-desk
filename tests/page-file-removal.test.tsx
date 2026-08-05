// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import Home from '@/app/page';
import type { OfferLetterExtraction } from '@/lib/schemas/extraction';

vi.mock('next/dynamic', () => ({
  default: () => {
    return function DynamicStub(props: { results?: { fileName: string }[]; files?: Record<string, unknown> }) {
      return (
        <div
          data-testid="dynamic-stub"
          data-results={JSON.stringify((props.results ?? []).map((r) => r.fileName))}
          data-file-count={String(Object.keys(props.files ?? {}).length)}
        />
      );
    };
  },
}));

function makeExtraction(): OfferLetterExtraction {
  return {
    candidateName: { value: 'Alex Morgan', rawQuote: 'Alex Morgan', pageNum: 1, confidence: 'high' },
    baseSalary: { value: 185000, rawQuote: '185,000', pageNum: 1, confidence: 'high' },
  } as unknown as OfferLetterExtraction;
}

interface SetupResult {
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}

let fetchMock: Mock;

function setup(): SetupResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Home />);
  });
  return { container, root };
}

function mockFetchForFiles(fileNames: string[]): Mock {
  const documents = fileNames.map((fileName) => ({
    fileName,
    sourceFormat: 'pdf',
    pages: [{ pageNum: 1, text: 'sample', runs: [] }],
  }));
  const results = fileNames.map((fileName) => ({
    fileName,
    trusted: true,
    flaggedFields: [],
    extractions: makeExtraction(),
    locations: {},
    mathDiscrepancies: [],
    source: 'live',
  }));

  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/api/parse')) {
      return { ok: true, status: 200, json: async () => ({ documents, errors: [] }) };
    }
    if (path.includes('/api/extract')) {
      return { ok: true, status: 200, json: async () => ({ results, errors: [], alignment: null, demoMode: false }) };
    }
    throw new Error(`Unexpected fetch in test: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function selectFiles(container: HTMLElement, fileNames: string[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const files = fileNames.map((name, i) => new File([`content-${i}`], name, { type: 'application/pdf' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function stubResults(container: HTMLElement): string[] | null {
  const stub = container.querySelector('[data-testid="dynamic-stub"]');
  const raw = stub?.getAttribute('data-results');
  return raw ? (JSON.parse(raw) as string[]) : null;
}

describe('Document upload file removal', () => {
  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
  });

  it('removing one file drops its chip and its table column while keeping the rest', async () => {
    mockFetchForFiles(['offer_a.pdf', 'offer_b.pdf']);
    const { container, root } = setup();

    await selectFiles(container, ['offer_a.pdf', 'offer_b.pdf']);
    expect(container.querySelector('button[aria-label="Remove offer_b.pdf"]')).not.toBeNull();
    expect(stubResults(container)).toEqual(['offer_a.pdf', 'offer_b.pdf']);
    expect(container.querySelector('[data-testid="dynamic-stub"]')?.getAttribute('data-file-count')).toBe('2');

    act(() => {
      (container.querySelector('button[aria-label="Remove offer_a.pdf"]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('button[aria-label="Remove offer_a.pdf"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Remove offer_b.pdf"]')).not.toBeNull();
    expect(stubResults(container)).toEqual(['offer_b.pdf']);
    expect(container.querySelector('[data-testid="dynamic-stub"]')?.getAttribute('data-file-count')).toBe('1');

    act(() => root.unmount());
    container.remove();
  });

  it('removing the last file returns the UI to the empty idle upload state', async () => {
    mockFetchForFiles(['offer_a.pdf', 'offer_b.pdf']);
    const { container, root } = setup();

    await selectFiles(container, ['offer_a.pdf', 'offer_b.pdf']);
    expect(container.querySelector('button[aria-label="Remove offer_b.pdf"]')).not.toBeNull();
    expect(stubResults(container)).toEqual(['offer_a.pdf', 'offer_b.pdf']);

    act(() => {
      (container.querySelector('button[aria-label="Remove offer_a.pdf"]') as HTMLButtonElement).click();
    });
    act(() => {
      (container.querySelector('button[aria-label="Remove offer_b.pdf"]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-testid="dynamic-stub"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="Remove"]')).toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.textContent).toContain('Drop PDF, DOCX, or XLSX files here');

    act(() => root.unmount());
    container.remove();
  });

  it('stages a single file without calling /api/extract or showing an error, then compares once a second file arrives', async () => {
    mockFetchForFiles(['offer_a.pdf', 'offer_b.pdf']);
    const { container, root } = setup();

    await selectFiles(container, ['offer_a.pdf']);
    expect(container.querySelector('button[aria-label="Remove offer_a.pdf"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dynamic-stub"]')).toBeNull();
    expect(container.textContent).toContain('Add at least one more document to run the comparison.');
    expect(container.textContent).not.toContain('Document Processing Issue Detected');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/extract'))).toBe(false);

    await selectFiles(container, ['offer_b.pdf']);
    expect(container.querySelector('button[aria-label="Remove offer_b.pdf"]')).not.toBeNull();
    expect(stubResults(container)).toEqual(['offer_a.pdf', 'offer_b.pdf']);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/extract'))).toBe(true);

    act(() => root.unmount());
    container.remove();
  });
});
