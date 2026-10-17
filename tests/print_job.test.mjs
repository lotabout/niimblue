import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePrintProgress, printPages } from "../src/utils/print_job.ts";

const makeJob = (overrides = {}, hooks = {}) => {
  const calls = [];
  const controller = new AbortController();
  const options = {
    pageCount: 34,
    quantity: 1,
    singlePageSessions: true,
    signal: controller.signal,
    renderPage: async (page) => {
      calls.push(["render", page]);
      await hooks.render?.(page);
      return { page };
    },
    onSessionStart: (completed, pages) => calls.push(["session", completed, pages]),
    createTask: (totalPages) => {
      const session = calls.filter(([name]) => name === "create").length;
      calls.push(["create", totalPages]);
      return {
        printInit: async () => {
          calls.push(["init", session]);
          await hooks.init?.(session);
        },
        printPage: async (image, quantity) => {
          calls.push(["page", image.page, quantity]);
          await hooks.page?.(image.page);
        },
        // B1 inherits this no-op from AbstractPrintTask.
        waitForPageFinished: async () => {
          calls.push(["waitPage", session]);
          await hooks.waitPage?.(session);
        },
        waitForFinished: async () => {
          calls.push(["waitFinished", session]);
          await hooks.waitFinished?.(session);
        },
        printEnd: async () => {
          calls.push(["end", session]);
          return (await hooks.end?.(session)) ?? true;
        },
      };
    },
    ...overrides,
  };
  return { calls, controller, run: () => printPages(options) };
};

test("34 distinct CSV pages each finish and end before the next session starts", async () => {
  let finishFirst;
  const job = makeJob(
    {},
    {
      waitFinished: (session) =>
        session === 0
          ? new Promise((resolve) => {
              finishFirst = resolve;
            })
          : undefined,
    },
  );
  const running = job.run();
  // Let the first session reach its printer status wait.
  await new Promise(setImmediate);
  assert.deepEqual(job.calls, [
    ["render", 0],
    ["session", 0, 1],
    ["create", 1],
    ["init", 0],
    ["page", 0, 1],
    ["waitPage", 0],
    ["waitFinished", 0],
  ]);
  finishFirst();
  await running;

  const expected = [];
  for (let page = 0; page < 34; page++) {
    expected.push(
      ["render", page],
      ["session", page, 1],
      ["create", 1],
      ["init", page],
      ["page", page, 1],
      ["waitPage", page],
      ["waitFinished", page],
      ["end", page],
    );
  }
  assert.deepEqual(job.calls, expected);
});

test("copies are preserved within each independent page session", async () => {
  const job = makeJob({ pageCount: 3, quantity: 2 });
  await job.run();
  assert.deepEqual(
    job.calls.filter(([name]) => name === "create"),
    [
      ["create", 2],
      ["create", 2],
      ["create", 2],
    ],
  );
  assert.deepEqual(
    job.calls.filter(([name]) => name === "page"),
    [
      ["page", 0, 2],
      ["page", 1, 2],
      ["page", 2, 2],
    ],
  );
  assert.deepEqual(
    job.calls.filter(([name]) => name === "session"),
    [
      ["session", 0, 2],
      ["session", 2, 2],
      ["session", 4, 2],
    ],
  );
});

test("continuous mode keeps all pages and copies in one session", async () => {
  const job = makeJob({ pageCount: 3, quantity: 2, singlePageSessions: false });
  await job.run();
  assert.deepEqual(job.calls, [
    ["render", 0],
    ["session", 0, 6],
    ["create", 6],
    ["init", 0],
    ["page", 0, 2],
    ["waitPage", 0],
    ["render", 1],
    ["page", 1, 2],
    ["waitPage", 0],
    ["render", 2],
    ["page", 2, 2],
    ["waitPage", 0],
    ["waitFinished", 0],
    ["end", 0],
  ]);
});

for (const stage of ["init", "page", "waitPage", "waitFinished"]) {
  test(`${stage} failure ends the session and sends no subsequent page`, async () => {
    const failure = new Error("Print error 6: DataError");
    const job = makeJob(
      {},
      {
        [stage]: () => {
          throw failure;
        },
      },
    );
    await assert.rejects(job.run(), (error) => error === failure);
    assert.equal(job.calls.filter(([name]) => name === "end").length, 1);
    assert.equal(job.calls.filter(([name]) => name === "create").length, 1);
    assert.ok(job.calls.filter(([name]) => name === "page").length <= 1);
  });
}

test("a render failure does not open a session", async () => {
  const job = makeJob(
    {},
    {
      render: () => {
        throw new Error("Render failed");
      },
    },
  );
  await assert.rejects(job.run(), /Render failed/);
  assert.deepEqual(job.calls, [["render", 0]]);
});

test("cleanup failure preserves the original printing error", async (t) => {
  t.mock.method(console, "error", () => {});
  const failure = new Error("Print error 6: DataError");
  const job = makeJob(
    {},
    {
      page: () => {
        throw failure;
      },
      end: () => {
        throw new Error("Disconnected");
      },
    },
  );
  await assert.rejects(job.run(), (error) => error === failure);
  assert.equal(console.error.mock.callCount(), 1);
});

for (const result of [false, new Error("End failed")]) {
  test(`failed PrintEnd (${result}) prevents the next session`, async () => {
    const job = makeJob(
      {},
      {
        end: () => {
          if (result instanceof Error) throw result;
          return result;
        },
      },
    );
    await assert.rejects(job.run(), /end|End/);
    assert.equal(job.calls.filter(([name]) => name === "create").length, 1);
    assert.equal(job.calls.filter(([name]) => name === "end").length, 1);
  });
}

test("cancellation before printing sends nothing", async () => {
  const job = makeJob();
  job.controller.abort();
  await assert.rejects(job.run(), { name: "AbortError" });
  assert.deepEqual(job.calls, []);
});

for (const stage of ["render", "init", "page", "waitPage", "waitFinished", "end"]) {
  test(`cancellation during ${stage} prevents later pages`, async () => {
    const job = makeJob({}, { [stage]: () => job.controller.abort() });
    await assert.rejects(job.run(), { name: "AbortError" });
    assert.equal(job.calls.filter(([name]) => name === "end").length, stage === "render" ? 0 : 1);
    assert.ok(job.calls.filter(([name]) => name === "page").length <= 1);
    assert.ok(job.calls.filter(([name]) => name === "create").length <= 1);
  });
}

test("cancelling a pending status poll releases the job and ends the session", async () => {
  let polling;
  const ready = new Promise((resolve) => {
    polling = resolve;
  });
  const job = makeJob(
    {},
    {
      waitFinished: () => {
        polling();
        return new Promise(() => {});
      },
    },
  );
  const running = job.run();
  await ready;
  job.controller.abort();
  await assert.rejects(running, { name: "AbortError" });
  assert.deepEqual(job.calls.at(-1), ["end", 0]);
  assert.equal(job.calls.filter(([name]) => name === "create").length, 1);
});

test("progress uses one-based printer pages and accounts for previous sessions", () => {
  const progress = (page, print, feed, completed = 0, session = 2, total = 6) =>
    calculatePrintProgress({ page, pagePrintProgress: print, pageFeedProgress: feed }, completed, session, total);
  assert.equal(progress(1, 0, 0), 0);
  assert.equal(progress(1, 100, 100), 16);
  assert.equal(progress(2, 100, 100), 33);
  assert.equal(progress(1, 0, 0, 2), 33);
  assert.equal(progress(2, 100, 100, 4), 100);
  assert.equal(progress(1, 0, 0, 0, 1, 1), 0);
  assert.equal(progress(1, 100, 100, 0, 1, 1), 100);
});

for (const overrides of [{ pageCount: 0 }, { quantity: 0 }, { quantity: 1.5 }]) {
  test(`invalid job ${JSON.stringify(overrides)} sends nothing`, async () => {
    const job = makeJob(overrides);
    await assert.rejects(job.run(), /positive integers/);
    assert.deepEqual(job.calls, []);
  });
}
