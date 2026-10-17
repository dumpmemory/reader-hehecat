import { Download } from "lucide-react";
import * as React from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { errorMessage } from "@/hooks/useBookshelf";
import { UNAUTHORIZED_EVENT } from "@/lib/api-client";
import { normalizeBookContentType } from "@/lib/book-type";
import { humanizeError } from "@/lib/errors";
import {
  exportBookFile,
  saveBookExport,
  type BookExportFile,
  type BookExportFormat,
} from "@/services/export";

export interface BookDownloadTarget {
  bookUrl: string;
  name: string;
  type: number | undefined;
  inShelf: boolean;
}

export interface BookDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book: BookDownloadTarget | null;
  format: BookExportFormat;
}

export function getBookDownloadDisabledReason(
  inShelf: boolean,
  contentType: ReturnType<typeof normalizeBookContentType>,
): string | undefined {
  if (!inShelf) {
    return "请先加入书架后再下载";
  }
  if (contentType === undefined) {
    return "无法识别书籍类型，暂不支持下载";
  }
  return contentType === 0 ? undefined : "仅文本书籍支持 TXT/EPUB 下载，音频、图片等暂不支持";
}

export function BookDownloadDialog({ open, onOpenChange, book, format }: BookDownloadDialogProps) {
  if (!open || book === null) {
    return null;
  }
  return (
    <BookDownloadSession
      key={JSON.stringify([book.bookUrl, book.name, book.type, book.inShelf, format])}
      book={book}
      format={format}
      onOpenChange={onOpenChange}
    />
  );
}

function BookDownloadSession({
  book,
  format,
  onOpenChange,
}: Omit<BookDownloadDialogProps, "open" | "book"> & { book: BookDownloadTarget }) {
  const [file, setFile] = React.useState<BookExportFile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [cancelled, setCancelled] = React.useState(false);
  const controllerRef = React.useRef<AbortController | null>(null);
  const generationRef = React.useRef(0);
  const fileGenerationRef = React.useRef<number | null>(null);
  const activeRef = React.useRef(false);
  const formatLabel = format.toUpperCase();
  const disabledReason = getBookDownloadDisabledReason(
    book.inShelf,
    normalizeBookContentType(book.type),
  ) ?? (book.bookUrl.trim() === "" ? "未找到书籍链接，暂不支持下载" : undefined);

  const abortRequest = React.useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  React.useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      abortRequest();
    };
  }, [abortRequest]);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      activeRef.current = false;
      abortRequest();
      fileGenerationRef.current = null;
      setFile(null);
      setLoading(false);
      onOpenChange(false);
    }
  }, [abortRequest, onOpenChange]);

  React.useLayoutEffect(() => {
    const handleUnauthorized = () => handleOpenChange(false);
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [handleOpenChange]);

  const saveFile = (target: BookExportFile, generation: number | null) => {
    if (
      !activeRef.current || disabledReason !== undefined || generation !== generationRef.current
      || controllerRef.current?.signal.aborted
    ) {
      return;
    }
    setError(null);
    try {
      saveBookExport(target);
      setSaved(true);
    } catch (saveError) {
      setError(humanizeError(errorMessage(saveError, "未能发起下载，请再次保存")));
    }
  };

  const handleStart = async () => {
    if (!activeRef.current || disabledReason !== undefined || controllerRef.current !== null) {
      return;
    }
    const controller = new AbortController();
    const generation = ++generationRef.current;
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    setFile(null);
    fileGenerationRef.current = null;
    setSaved(false);
    setCancelled(false);
    try {
      const exportedFile = await exportBookFile(book.bookUrl, book.name, format, {
        timeout: 600_000,
        signal: controller.signal,
      });
      if (!activeRef.current || controller.signal.aborted || generation !== generationRef.current) {
        return;
      }
      fileGenerationRef.current = generation;
      setFile(exportedFile);
      saveFile(exportedFile, generation);
    } catch (requestError) {
      if (activeRef.current && !controller.signal.aborted && generation === generationRef.current) {
        setError(humanizeError(errorMessage(requestError, "下载失败，请重试")));
      }
    } finally {
      if (activeRef.current && generation === generationRef.current) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const handleCancel = () => {
    abortRequest();
    setLoading(false);
    setFile(null);
    fileGenerationRef.current = null;
    setError(null);
    setSaved(false);
    setCancelled(true);
  };
  const warning = file?.warning;
  const failedChapters = warning?.failedChapters ?? [];

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent width="md">
        <DialogHeader>
          <DialogTitle>下载 {formatLabel}</DialogTitle>
          <DialogDescription className="break-words">
            《{book.name}》 · {formatLabel} 格式
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-4 pb-4 text-sm leading-relaxed md:px-5">
          <p className="text-muted-foreground">
            在线书籍未缓存的章节需要回源，整书导出可能较慢（最长等待 10 分钟）。先缓存本书通常更快；下载文件不等于整书缓存。
          </p>
          {disabledReason !== undefined ? (
            <p role="alert" className="text-accent">{disabledReason}</p>
          ) : null}
          {loading ? (
            <p role="status" className="text-muted-foreground">
              正在生成 {formatLabel} 文件，请稍候。取消或关闭只会中止浏览器请求，服务端可能仍在处理。
            </p>
          ) : null}
          {cancelled ? (
            <p role="status" className="text-muted-foreground">
              已取消浏览器请求，服务端可能仍在处理；需要时可重新开始。
            </p>
          ) : null}
          {file !== null ? (
            <p role="status" className="break-words">
              {saved ? "已发起下载，请查看浏览器下载列表。" : "文件已生成，可再次保存。"}
              <span className="mt-1 block text-xs text-muted-foreground">{file.filename}</span>
            </p>
          ) : null}
          {warning !== undefined && (
            failedChapters.length > 0 || warning.unmappableChars > 0 || warning.unknown
          ) ? (
            <div role="alert" className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-accent">
              {failedChapters.length > 0 ? (
                <>
                  <p>{failedChapters.length} 章导出失败，文件可能缺少内容：</p>
                  <ul className="list-inside list-disc space-y-1 break-words text-xs">
                    {failedChapters.slice(0, 5).map((chapter, position) => (
                      <li key={`${chapter.index}-${position}`}>
                        {chapter.title.trim() || `第 ${chapter.index + 1} 章`}
                      </li>
                    ))}
                  </ul>
                  {failedChapters.length > 5 ? <p className="text-xs">另有 {failedChapters.length - 5} 章失败</p> : null}
                </>
              ) : null}
              {warning.unmappableChars > 0 ? <p>有 {warning.unmappableChars} 个无法映射的字符，请检查导出文件。</p> : null}
              {warning.unknown ? <p>无法解析导出警告，无法确认内容是否有缺失，请检查导出文件。</p> : null}
            </div>
          ) : null}
          {error !== null ? <p role="alert" className="text-danger">{error}</p> : null}
          <p className="text-xs text-muted-foreground">生成的文件仅保留在当前弹窗内存中，关闭后清理。</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>关闭</Button>
          {loading ? <Button variant="secondary" onClick={handleCancel}>取消请求</Button> : null}
          {file !== null ? (
            <Button disabled={disabledReason !== undefined} onClick={() => saveFile(file, fileGenerationRef.current)}>
              <Download aria-hidden />
              再次保存
            </Button>
          ) : (
            <Button loading={loading} disabled={disabledReason !== undefined} onClick={() => void handleStart()}>
              <Download aria-hidden />
              {loading ? "正在生成…" : error !== null ? "重试下载" : "开始下载"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
