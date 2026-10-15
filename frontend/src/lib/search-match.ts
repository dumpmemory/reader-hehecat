export interface SearchTarget {
  key: string;
  exact: boolean;
}

export function normalizeSearchText(value: string): string {
  return value.trim().replace(/[\uFF01-\uFF5E]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xFEE0),
  ).replace(/\u3000/g, " ").toLowerCase();
}

export function searchTarget(value: string, exact = false): SearchTarget {
  const key = value.trim();
  return key.startsWith("=")
    ? { key: key.slice(1).trim(), exact: true }
    : { key, exact };
}

export function matchesSearchKey(
  book: { name: string; author?: string | null; intro?: string | null },
  key: string,
  exact = false,
): boolean {
  const target = searchTarget(key, exact);
  const query = normalizeSearchText(target.key);
  const name = normalizeSearchText(book.name);
  const author = normalizeSearchText(book.author ?? "");
  if (target.exact) {
    return query.length > 0 && (name === query || (author.length > 0 && author === query));
  }
  const fields = [name, author, normalizeSearchText(book.intro ?? "")];
  return query.split(/\s+/).filter(Boolean)
    .every((token) => fields.some((field) => field.includes(token)));
}

export function matchesSourceTitle(name: string, title: string, exact: boolean): boolean {
  const candidate = normalizeSearchText(name);
  const query = normalizeSearchText(title);
  return candidate.length > 0 && query.length > 0
    && (exact ? candidate === query : candidate.includes(query) || query.includes(candidate));
}
