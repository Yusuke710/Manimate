export type LibrarySearchRecord = {
  title?: string | null;
  plan_content?: string | null;
  script_content?: string | null;
};

export type LibrarySearchIndex = {
  corpusText: string;
  corpusTokens: string[];
};

const MAX_DISTANCE_BY_LENGTH = [
  { maxLength: 4, distance: 1 },
  { maxLength: 8, distance: 2 },
  { maxLength: Number.POSITIVE_INFINITY, distance: 3 },
] as const;

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/) : [];
}

function getMaxDistance(token: string): number {
  return MAX_DISTANCE_BY_LENGTH.find((entry) => token.length <= entry.maxLength)?.distance ?? 1;
}

function boundedEditDistance(left: string, right: string, maxDistance: number): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    let rowMin = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const nextDistance = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
      current[rightIndex] = nextDistance;
      rowMin = Math.min(rowMin, nextDistance);
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    [previous, current] = [current, previous];
  }

  return previous[right.length];
}

function tokenMatchesCorpus(token: string, corpusText: string, corpusTokens: string[]): boolean {
  if (corpusText.includes(token)) return true;

  const maxDistance = getMaxDistance(token);
  return corpusTokens.some((candidate) => {
    if (token.length < 4 || candidate.length < 3 || candidate[0] !== token[0]) return false;
    if (Math.abs(candidate.length - token.length) > maxDistance) return false;
    return boundedEditDistance(token, candidate, maxDistance) <= maxDistance;
  });
}

export function buildLibrarySearchIndex(record: LibrarySearchRecord): LibrarySearchIndex {
  const corpusText = normalizeSearchText([
    record.title,
    record.plan_content,
    record.script_content,
  ].filter(Boolean).join(" "));

  return {
    corpusText,
    corpusTokens: Array.from(new Set(corpusText.split(/\s+/).filter(Boolean))),
  };
}

export function matchesLibrarySearchIndex(index: LibrarySearchIndex, query: string): boolean {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return true;
  if (!index.corpusText) return false;
  if (index.corpusText.includes(queryTokens.join(" "))) return true;

  return queryTokens.every((token) =>
    tokenMatchesCorpus(token, index.corpusText, index.corpusTokens),
  );
}

export function matchesLibrarySearch(record: LibrarySearchRecord, query: string): boolean {
  return matchesLibrarySearchIndex(buildLibrarySearchIndex(record), query);
}
