import type { AbstractPrintTask, EncodedImage, PrintProgressEvent } from "@mmote/niimbluelib";

type PrintTask = Pick<
  AbstractPrintTask,
  "printInit" | "printPage" | "waitForPageFinished" | "waitForFinished" | "printEnd"
>;

interface PrintJobOptions {
  pageCount: number;
  quantity: number;
  singlePageSessions: boolean;
  createTask: (totalPages: number) => PrintTask;
  renderPage: (page: number) => Promise<EncodedImage>;
  onSessionStart: (completedPages: number, sessionPages: number) => void;
  signal: AbortSignal;
}

// PrintEnd cancels the library's status poll without settling its promise.
// Stop waiting on cancellation so session cleanup can send PrintEnd.
const waitForTask = async (operation: () => Promise<void>, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

export const printPages = async (options: PrintJobOptions): Promise<void> => {
  const { pageCount, quantity, singlePageSessions, createTask, renderPage, onSessionStart, signal } = options;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || !Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Page count and quantity must be positive integers");
  }

  const sessionSize = singlePageSessions ? 1 : pageCount;
  for (let start = 0; start < pageCount; start += sessionSize) {
    signal.throwIfAborted();
    // Render before PrintStart so the printer does not wait for the first image.
    const firstImage = await renderPage(start);
    signal.throwIfAborted();
    const sessionPages = Math.min(sessionSize, pageCount - start);
    onSessionStart(start * quantity, sessionPages * quantity);
    const task = createTask(sessionPages * quantity);
    let failed = false;
    let failure: unknown;
    try {
      await task.printInit();
      signal.throwIfAborted();
      for (let page = start; page < start + sessionPages; page++) {
        const image = page === start ? firstImage : await renderPage(page);
        signal.throwIfAborted();
        await task.printPage(image, quantity);
        signal.throwIfAborted();
        await waitForTask(() => task.waitForPageFinished(), signal);
      }
      await waitForTask(() => task.waitForFinished(), signal);
      signal.throwIfAborted();
    } catch (e) {
      failed = true;
      failure = e;
    }

    try {
      if (!(await task.printEnd())) {
        throw new Error("Printer refused to end the print session");
      }
    } catch (e) {
      // Keep the original print error if cleanup fails as well.
      if (!failed) throw e;
      console.error("Failed to end print session", e);
    }
    if (failed) throw failure;
  }
};

export const calculatePrintProgress = (
  event: Pick<PrintProgressEvent, "page" | "pagePrintProgress" | "pageFeedProgress">,
  completedPages: number,
  sessionPages: number,
  totalPages: number,
): number => {
  const fraction = (event.pagePrintProgress + event.pageFeedProgress) / 200;
  const sessionProgress = Math.min(sessionPages, Math.max(0, event.page - 1) + fraction);
  return Math.min(100, Math.floor(((completedPages + sessionProgress) / totalPages) * 100));
};
