import { ApiError, postFile, type ApiRequestConfig } from "@/lib/api-client";

export type BookExportFormat = "txt" | "epub";

export interface BookExportWarning {
  failedChapters: { index: number; title: string }[];
  unmappableChars: number;
  unknown: boolean;
}

export interface BookExportFile {
  blob: Blob;
  filename: string;
  warning: BookExportWarning;
}

const EXPORT_TIMEOUT = 10 * 60_000;

function exportWarning(header: string | undefined): BookExportWarning {
  const warning: BookExportWarning = { failedChapters: [], unmappableChars: 0, unknown: false };
  if (header === undefined) {
    return warning;
  }
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(header));
  } catch {
    return { ...warning, unknown: true };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...warning, unknown: true };
  }
  const payload = value as Record<string, unknown>;
  if (payload.failedChapters !== undefined) {
    if (!Array.isArray(payload.failedChapters)) {
      warning.unknown = true;
    } else {
      for (const item of payload.failedChapters as unknown[]) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          warning.unknown = true;
          continue;
        }
        const chapter = item as Record<string, unknown>;
        if (typeof chapter.index !== "number" || !Number.isSafeInteger(chapter.index)
          || chapter.index < 0 || typeof chapter.title !== "string") {
          warning.unknown = true;
          continue;
        }
        warning.failedChapters.push({ index: chapter.index, title: chapter.title });
      }
    }
  }
  if (payload.unmappableChars !== undefined) {
    if (typeof payload.unmappableChars === "number" && Number.isSafeInteger(payload.unmappableChars)
      && payload.unmappableChars >= 0) {
      warning.unmappableChars = payload.unmappableChars;
    } else {
      warning.unknown = true;
    }
  }
  if (Object.keys(payload).some((key) => key !== "failedChapters" && key !== "unmappableChars")
    || Object.keys(payload).length === 0) {
    warning.unknown = true;
  }
  return warning;
}

function exportFilename(header: string | undefined, name: string, format: BookExportFormat): string {
  let candidate = name;
  if (header !== undefined) {
    const extended = /filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/iu.exec(header);
    const regular = /filename\s*=\s*(?:"([^"]*)"|([^;]*))/iu.exec(header);
    const encoded = extended?.[1] ?? extended?.[2] ?? regular?.[1] ?? regular?.[2];
    if (encoded !== undefined) {
      try {
        const value = extended === null ? encoded.trim() : encoded.trim().replace(/^UTF-8'[^']*'/iu, "");
        candidate = decodeURIComponent(value);
      } catch {
        candidate = name;
      }
    }
  }
  const cleaned = Array.from(candidate)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && !(code >= 127 && code <= 159);
    })
    .join("")
    .replace(/[\\/:*?"<>|]/gu, "_")
    .replace(/^[.\s]+|[.\s]+$/gu, "");
  const suffix = `.${format}`;
  const stem = cleaned.toLowerCase().endsWith(suffix) ? cleaned.slice(0, -suffix.length) : cleaned;
  return `${Array.from(stem).slice(0, 160).join("") || "export"}${suffix}`;
}

export async function exportBookFile(
  bookUrl: string,
  bookName: string,
  format: BookExportFormat,
  config?: ApiRequestConfig,
): Promise<BookExportFile> {
  if (bookUrl.trim() === "") {
    throw new ApiError("请输入书籍链接");
  }
  if (format !== "txt" && format !== "epub") {
    throw new ApiError("不支持的下载格式");
  }
  const response = await postFile(
    "/exportBook",
    { url: bookUrl, format, ...(format === "txt" ? { encoding: "utf-8" } : {}) },
    { timeout: EXPORT_TIMEOUT, ...config },
  );
  const contentType = (String(response.headers["content-type"] ?? "").split(";", 1)[0] ?? "").trim().toLowerCase();
  const expectedType = format === "txt" ? "text/plain" : "application/epub+zip";
  if (contentType !== expectedType || response.data.size === 0) {
    throw new ApiError("下载响应不是有效书籍文件");
  }
  const disposition = response.headers["content-disposition"];
  const warning = response.headers["x-export-warning"];
  return {
    blob: response.data,
    filename: exportFilename(typeof disposition === "string" ? disposition : undefined, bookName, format),
    warning: exportWarning(typeof warning === "string" ? warning : undefined),
  };
}

export function saveBookExport(file: BookExportFile): void {
  const objectUrl = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = objectUrl;
    anchor.download = file.filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}
