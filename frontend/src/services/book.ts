import { z } from "zod";
import { proxiedAssetUrl } from "@/lib/asset";
import { ApiError, parseWith, post, type ApiRequestConfig } from "@/lib/api-client";
import { plainIntro } from "@/lib/text";
import {
  bookChapterListSchema,
  bookSchema,
  type Book,
  type BookChapter,
  type SearchBook,
} from "@/types/api";

/**
 * 书籍不在书架时(例如来自搜索结果), 必须显式带上书源链接: warp 的抓取接口
 * 靠 bookSource 参数选源, 缺省时落到服务端默认源而非按 URL 匹配.
 */
export interface BookSourceHint {
  bookSourceUrl?: string;
}

/** 抓取类接口(详情/目录/正文)走外网书源, 慢源常超 30s, 默认超时放宽 */
const FETCH_TIMEOUT = 120_000;

/** getBookInfo 入参: 书籍 url / 搜索结果 / 带书源提示的 url */
export type BookInfoQuery = string | SearchBook | (BookSourceHint & { url: string });

/** 归一化后的章节正文 */
export interface BookContent {
  /**
   * 后端当前只返回正文 HTML 字符串(BookController.getBookContent → setData(content)),
   * 此时 title 为空串, 请改用章节列表里对应 index 的 title.
   */
  title: string;
  /** HTML 字符串, 渲染前必须经 DOMPurify 清洗 */
  content: string;
  nextContentUrl?: string;
}

export const bookContentSchema = z.union([
  z.string().transform((content) => ({ title: "", content })),
  z.object({
    title: z.string().default(""),
    content: z.string(),
    nextContentUrl: z.string().optional(),
  }),
]);

export interface BookContentOptions extends BookSourceHint {
  /** 忽略服务器章节缓存, 重新抓取 */
  refresh?: boolean;
  /** 只读缓存, 且不写入阅读进度 */
  cache?: boolean;
  /** 书籍 URL: warp 正文缓存命中条件 (缺省则跳过缓存直抓, 恒定数秒) */
  bookUrl?: string;
  /** 章节标题: 规则上下文 @get:{title} */
  title?: string;
  retryCount?: number;
}

export async function getBookInfo(
  query: BookInfoQuery,
  config?: ApiRequestConfig,
): Promise<Book> {
  const body: Record<string, unknown> =
    typeof query === "string"
      ? { url: query }
      : "bookUrl" in query
        ? // 搜索结果: 后端从 searchBook.bookUrl 取链接, 书源用 origin (warp 参数名 bookSource)
          { searchBook: query, bookSource: query.origin }
        : { url: query.url, bookSource: query.bookSourceUrl };
  const data = await post<unknown>("/getBookInfo", body, { timeout: FETCH_TIMEOUT, ...config });
  return parseWith(bookSchema, data);
}

export async function getChapterList(
  url: string,
  refresh?: boolean,
  hint?: BookSourceHint,
  config?: ApiRequestConfig,
): Promise<BookChapter[]> {
  const data = await post<unknown>(
    "/getChapterList",
    { url, refresh: refresh ? 1 : 0, bookSource: hint?.bookSourceUrl },
    { timeout: FETCH_TIMEOUT, ...config },
  );
  return parseWith(bookChapterListSchema, data);
}

function isSourceErrorContent(content: string): boolean {
  const text = plainIntro(content);
  if (Array.from(text).length > 512) {
    return false;
  }
  const compact = text.replace(/\s+/gu, "").replace(/[。.！!]+$/u, "");
  return /^获取数据失败[，,。.:：]*请稍后再试[，,。.:：]*错误详情[:：][A-Za-z0-9_.:()/-]+$/u.test(compact);
}

function bookContentPayload(
  url: string,
  index: number,
  options?: BookContentOptions,
) {
  if (options?.retryCount !== undefined
    && (!Number.isInteger(options.retryCount) || options.retryCount < 0 || options.retryCount > 5)) {
    throw new ApiError("重试次数须为 0–5 的整数");
  }
  return {
    url,
    index,
    refresh: options?.refresh ? 1 : undefined,
    cache: options?.cache ? 1 : undefined,
    bookSource: options?.bookSourceUrl,
    bookUrl: options?.bookUrl,
    title: options?.title,
    retryCount: options?.retryCount,
  };
}

async function requestBookContent(
  endpoint: "/getBookContent" | "/refreshBookContent",
  url: string,
  index: number,
  options?: BookContentOptions,
  config?: ApiRequestConfig,
): Promise<BookContent> {
  const data = await post<unknown>(
    endpoint,
    bookContentPayload(url, index, options),
    { timeout: FETCH_TIMEOUT, ...config },
  );
  const content = parseWith(bookContentSchema, data);
  if (content.content.trim() === "") {
    throw new ApiError(endpoint === "/refreshBookContent"
      ? "章节正文为空，已保留原内容"
      : "章节正文为空");
  }
  if (isSourceErrorContent(content.content)) {
    throw new ApiError("书源返回了获取数据失败提示，而非章节正文");
  }
  return content;
}

/** warp 契约: url = 章节页 URL (chapterUrl), index 仅用于回写书架进度; Kotlin 旧形 bookUrl+index 已废 */
export async function getBookContent(
  url: string,
  index: number,
  options?: BookContentOptions,
  config?: ApiRequestConfig,
): Promise<BookContent> {
  return requestBookContent("/getBookContent", url, index, options, config);
}

export async function refreshBookContent(
  url: string,
  index: number,
  options?: Omit<BookContentOptions, "refresh" | "cache">,
  config?: ApiRequestConfig,
): Promise<BookContent> {
  return requestBookContent("/refreshBookContent", url, index, options, config);
}

/** 保存阅读进度到书架(章节内位置由后端按章节列表写入) */
export async function saveBookProgress(
  url: string,
  index: number,
  title?: string,
  config?: ApiRequestConfig,
): Promise<void> {
  await post<unknown>(
    "/saveBookProgress",
    { url, index, durChapterTitle: title === undefined ? undefined : title },
    config,
  );
}

/**
 * 封面地址, 可直接用作 `<img src>`.
 * warp 没有 /reader3/cover 代理(404), 与 bundled UI 一致直接热链原站 URL:
 * path 为书籍的 customCoverUrl / coverUrl, 原样返回; 为空时返回空串
 * (调用方经 CoverImage 渲染书脊兜底, 热链加载失败同样退书脊).
 */
export function getCoverUrl(path?: string | null): string {
  return proxiedAssetUrl(path ?? "");
}

/** 全书搜索命中(章节名与正文同表: 后端 /searchBookContent, 正文仅覆盖已缓存章节) */
export const bookContentHitSchema = z.object({
  chapterIndex: z.number(),
  title: z.string().default(""),
  snippet: z.string().default(""),
});

export type BookContentHit = z.infer<typeof bookContentHitSchema>;

const bookContentHitListSchema = z.array(bookContentHitSchema);

/**
 * 书内搜索正文: 命中来自 `book_chapters`(本地书全文 + 书源书已缓存正文)。
 * 书源书未缓存章节不会命中 —— 调用方应提示"先缓存本书"。
 */
export async function searchBookContent(
  bookUrl: string,
  key: string,
  config?: ApiRequestConfig,
): Promise<BookContentHit[]> {
  const data = await post<unknown>(
    "/searchBookContent",
    { bookUrl, key },
    { timeout: FETCH_TIMEOUT, ...config },
  );
  return parseWith(bookContentHitListSchema, data);
}
