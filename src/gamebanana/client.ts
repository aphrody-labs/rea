const API_ROOT = "https://gamebanana.com/apiv11";
const MAX_PAGE = 10_000;
const MAX_PER_PAGE = 50;

export interface GameBananaItem {
  id: number;
  model: string;
  name: string;
  url: string;
  game?: string;
  gameUrl?: string;
  category?: string;
  author?: string;
  likes?: number;
  views?: number;
  hasFiles?: boolean;
}

export interface GameBananaSearchResult {
  total: number;
  page: number;
  perPage: number;
  records: GameBananaItem[];
}

type ApiRecord = Record<string, unknown>;

function object(value: unknown): ApiRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ApiRecord)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function mapRecord(input: unknown): GameBananaItem | undefined {
  const row = object(input);
  const id = number(row?._idRow);
  const model = text(row?._sModelName);
  const name = text(row?._sName);
  const url = text(row?._sProfileUrl);
  if (id === undefined || !model || !name || !url) return undefined;
  const game = object(row?._aGame);
  const category = object(row?._aRootCategory);
  const author = object(row?._aSubmitter);
  const gameName = text(game?._sName);
  const gameUrl = text(game?._sProfileUrl);
  const categoryName = text(category?._sName);
  const authorName = text(author?._sName);
  const likes = number(row?._nLikeCount);
  const views = number(row?._nViewCount);
  return {
    id,
    model,
    name,
    url,
    ...(gameName === undefined ? {} : { game: gameName }),
    ...(gameUrl === undefined ? {} : { gameUrl }),
    ...(categoryName === undefined ? {} : { category: categoryName }),
    ...(authorName === undefined ? {} : { author: authorName }),
    ...(likes === undefined ? {} : { likes }),
    ...(views === undefined ? {} : { views }),
    ...(typeof row?._bHasFiles === "boolean" ? { hasFiles: row._bHasFiles } : {}),
  };
}

async function getJson(path: string, query?: URLSearchParams): Promise<unknown> {
  const url = new URL(`${API_ROOT}/${path}`);
  if (query) url.search = query.toString();
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "yolo-re/1.0 (GameBanana read-only client)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GameBanana API returned HTTP ${response.status}`);
  return response.json();
}

export async function searchGameBanana(
  query: string,
  options: { page?: number; perPage?: number; model?: string; gameId?: number } = {},
): Promise<GameBananaSearchResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 200) {
    throw new Error("query must contain 1–200 characters");
  }
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 20;
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) throw new Error("page must be between 1 and 10000");
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) throw new Error("perPage must be between 1 and 50");
  const model = options.model ?? "Mod";
  if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(model)) throw new Error("model contains invalid characters");

  if (options.gameId !== undefined && (!Number.isSafeInteger(options.gameId) || options.gameId < 1)) {
    throw new Error("gameId must be a positive safe integer");
  }
  const params = options.gameId === undefined
    ? new URLSearchParams({ _sSearchString: normalizedQuery, _sModelName: model, _nPage: String(page), _nPerpage: String(perPage) })
    : new URLSearchParams({ _nPage: String(page), _nPerpage: String(perPage), "_aFilters[Generic_Game]": String(options.gameId) });
  const payload = object(await getJson(options.gameId === undefined ? "Util/Search/Results" : `${model}/Index`, params));
  const metadata = object(payload?._aMetadata);
  const records = Array.isArray(payload?._aRecords)
    ? payload._aRecords.map(mapRecord).filter((row): row is GameBananaItem => row !== undefined)
    : [];
  const matchingRecords = options.gameId === undefined
    ? records
    : records.filter((record) => `${record.name} ${record.category ?? ""} ${record.author ?? ""}`.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase()));
  return {
    total: number(metadata?._nRecordCount) ?? records.length,
    page,
    perPage: number(metadata?._nPerpage) ?? perPage,
    records: matchingRecords,
  };
}

export async function getGameBananaMod(id: number): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("mod id must be a positive safe integer");
  const payload = object(await getJson(`Mod/${id}/ProfilePage`));
  if (!payload) throw new Error("GameBanana returned an invalid mod profile");
  return payload;
}
