// Browser Use Cloud v4 (https://api.browser-use.com/api/v4): give an agent a
// natural-language goal, it drives a real cloud browser and returns the result.
// Used for the "visit a live site" tasks the CMA's tools cannot do.
//
// Split into start + await so the voice worker can show a live-view card the
// instant the browser is up (only the worker holds the LiveKit room, so the
// card push must go through it), then keep waiting for the result on a second
// call. One shared Browser Use account (BROWSER_USE_API_KEY); unauthenticated
// (no per-user login state stored) in this version.

// Overridable so tests and the end-to-end run can stand a fixture in for the service.
export const browserUseBase = (): string =>
  (process.env.BROWSER_USE_API_BASE ?? "https://api.browser-use.com/api/v4").replace(/\/$/, "");
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function browseEnabled(): boolean {
  return !!process.env.BROWSER_USE_API_KEY;
}

function buHeaders(): Record<string, string> {
  return {
    "X-Browser-Use-API-Key": process.env.BROWSER_USE_API_KEY as string,
    "Content-Type": "application/json",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BrowseStart {
  runId: string;
  liveUrl: string | null;
  /** The v4 session the run belongs to. Follow-up runs in it reuse its live browser. */
  sessionId: string | null;
}

/**
 * Create a run and return as soon as the browser's live-view URL is available
 * (a few seconds), so the caller can show it while the task runs. record:true
 * means a replay mp4 is retrievable afterward. maxCostUsd bounds spend.
 */
export async function startBrowse(task: string, onCreated?:(id:string,sessionId:string|null)=>void, signal?:AbortSignal): Promise<BrowseStart> {
  signal?.throwIfAborted();
  const cap = Number(process.env.BROWSER_USE_MAX_COST_USD ?? 0.75);
  const model = process.env.BROWSER_USE_MODEL; // omit -> Browser Use default (cheapest/fastest)
  const create = await fetch(`${browserUseBase()}/runs`, {
    method: "POST",
    signal:signal??AbortSignal.timeout(30000),
    headers: buHeaders(),
    body: JSON.stringify({
      task,
      agentmail:false,
      ...(model ? { model } : {}),
      maxCostUsd: cap,
      // Desktop viewport sized to roughly match the card's aspect so the remote
      // page fills it: wide enough (1280) that sites still render their desktop
      // layout, but tall enough that a width-scaled render doesn't leave an empty
      // band at the top or bottom of the card. Tunable via env if the card's
      // proportions change.
      browserSettings: {
        proxyCountryCode: "us",
        record: true,
        screenWidth: Number(process.env.BROWSER_USE_SCREEN_W ?? 1280),
        screenHeight: Number(process.env.BROWSER_USE_SCREEN_H ?? 1080),
      },
    }),
  });
  if (!create.ok) {
    throw new Error(`Browser service returned HTTP ${create.status}`);
  }
  const created = (await create.json()) as { id: string; sessionId?: string };
  const runId = created.id;
  const sessionId = created.sessionId ?? null;
  onCreated?.(runId, sessionId);

  // The embeddable live-view URL for an agent run lives in the RUN EVENT STREAM
  // (browser.ready / browser.attached -> data.live_view_url), not on the run or
  // the /browsers objects. It appears ~1.5s in; poll a short window for it, then
  // give up and run without a live card.
  let liveUrl: string | null = null;
  for (let i = 0; i < 8 && !liveUrl; i++) {
    signal?.throwIfAborted();
    await sleep(1500);
    try {
      const ev = await fetch(`${browserUseBase()}/runs/${runId}/events`, { headers: buHeaders() });
      if (!ev.ok) continue;
      const { events } = (await ev.json()) as {
        events?: Array<{ type?: string; data?: { live_view_url?: string | null } }>;
      };
      for (const e of events ?? []) {
        if ((e.type === "browser.ready" || e.type === "browser.attached") && e.data?.live_view_url) {
          liveUrl = e.data.live_view_url;
          break;
        }
      }
    } catch {
      // transient; keep trying within the window
    }
  }
  return { runId, liveUrl, sessionId };
}

/**
 * A follow-up turn in an existing v4 session. Browser Use documents that a
 * session "can reuse its live browser" and that passing its sessionId resumes
 * work "in the same browser across multiple follow-up runs"; browser settings
 * are owned by the browser, and "a live browser is reused as-is", so none are
 * sent here. Returns the new run's id.
 */
export async function continueBrowse(sessionId: string, task: string): Promise<string> {
  const model = process.env.BROWSER_USE_MODEL;
  const create = await fetch(`${browserUseBase()}/runs`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: buHeaders(),
    body: JSON.stringify({
      task,
      sessionId,
      agentmail: false,
      ...(model ? { model } : {}),
      maxCostUsd: Number(process.env.BROWSER_USE_MAX_COST_USD ?? 0.75),
    }),
  });
  if (!create.ok) throw new Error(`Browser service returned HTTP ${create.status}`);
  return ((await create.json()) as { id: string }).id;
}

/** The live-view link a run reports once its browser is up or attached, if any yet. */
export async function runLiveUrl(runId: string): Promise<string | null> {
  const ev = await fetch(`${browserUseBase()}/runs/${runId}/events`, { headers: buHeaders(), signal: AbortSignal.timeout(15000) });
  if (!ev.ok) return null;
  const { events } = (await ev.json()) as { events?: Array<{ type?: string; data?: { live_view_url?: string | null } }> };
  for (const e of events ?? []) {
    if ((e.type === "browser.ready" || e.type === "browser.attached") && e.data?.live_view_url) return e.data.live_view_url;
  }
  return null;
}

/** A readable record of what the computer-use agent actually did, for the trace. */
export interface BrowseDetail {
  status: string;
  model?: string;
  result?: string | null;
  error?: string | null;
  steps: string[]; // ordered agent narration + browser actions
  stepCount: number; // number of browser actions taken
  inputTokens?: number;
  outputTokens?: number;
  durationS?: number;
}

export interface BrowseOutcome {
  text: string | null;
  deferred: boolean;
  runId: string;
  cost?: string;
  recordingUrl?: string | null;
  detail?: BrowseDetail;
}

/**
 * Pull the run summary plus a compact, readable step list (the agent's plan
 * narration and the browser actions it took), so the trace shows what the
 * computer-use agent did -- not just that a task ran.
 */
export async function fetchRunDetail(runId: string): Promise<BrowseDetail> {
  const run = (await (await fetch(`${browserUseBase()}/runs/${runId}`, { headers: buHeaders() })).json()) as {
    status?: string;
    result?: string | null;
    error?: string | null;
    model?: string;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    createdAt?: string;
    updatedAt?: string;
  };
  const steps: string[] = [];
  let stepCount = 0;
  try {
    const ev = await fetch(`${browserUseBase()}/runs/${runId}/events`, { headers: buHeaders() });
    if (ev.ok) {
      const { events } = (await ev.json()) as {
        events?: Array<{ type?: string; data?: { part?: { type?: string; text?: string; tool?: string } } }>;
      };
      for (const e of events ?? []) {
        if (e.type !== "core.event") continue;
        const part = e.data?.part;
        if (!part) continue;
        if (part.type === "text" && part.text?.trim()) {
          // Private agent narration is deliberately excluded from operational evidence.
        } else if (part.type === "tool" && part.tool) {
          stepCount += 1;
          steps.push(`action: ${part.tool}`);
        }
        // Keep the array well under the trace's 2000-char/field cap so it stays
        // a real array, not a truncated string.
        if (steps.length >= 15) break;
      }
    }
  } catch {
    // events are best-effort; the result + summary still stand
  }
  let durationS: number | undefined;
  if (run.createdAt && run.updatedAt) {
    const d = (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000;
    if (Number.isFinite(d) && d >= 0) durationS = Math.round(d);
  }
  return {
    status: run.status ?? "unknown",
    model: run.model,
    result: run.result,
    error: run.error,
    steps,
    stepCount,
    inputTokens: run.totalInputTokens,
    outputTokens: run.totalOutputTokens,
    durationS,
  };
}

/**
 * Poll an existing run to terminal. If it finishes within maxWaitMs, return the
 * text; otherwise return deferred and keep polling in the background, handing
 * the late result to onLate.
 */
export async function awaitBrowse(
  runId: string,
  maxWaitMs: number,
  onLate: (text: string, meta: { runId: string; cost?: string; detail?: BrowseDetail }) => void,
): Promise<BrowseOutcome> {
  let timedOut = false;
  const poll = (async (): Promise<{ text: string; cost?: string; detail: BrowseDetail }> => {
    for (;;) {
      await sleep(3000);
      let status = "";
      try {
        const s = await fetch(`${browserUseBase()}/runs/${runId}/status`, { headers: buHeaders() });
        if (s.ok) status = ((await s.json()) as { status: string }).status;
      } catch {
        continue;
      }
      if (TERMINAL.has(status)) {
        const detail = await fetchRunDetail(runId);
        const cost = (await (await fetch(`${browserUseBase()}/runs/${runId}`, { headers: buHeaders() })).json())
          .totalCostUsd as string | undefined;
        const text =
          status === "completed"
            ? detail.result || "The browser task finished but returned no text."
            : `The browser task did not finish (${status}${detail.error ? ": " + detail.error : ""}).`;
        return { text, cost, detail };
      }
    }
  })();

  const timeout = new Promise<null>((resolve) => {
    const t = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, maxWaitMs);
    t.unref?.();
  });

  const finished = await Promise.race([poll, timeout]);
  if (finished !== null) {
    return { text: finished.text, deferred: false, runId, cost: finished.cost, detail: finished.detail };
  }
  void poll
    .then((o) => {
      if (timedOut && o.text) onLate(o.text, { runId, cost: o.cost, detail: o.detail });
    })
    .catch((err) => console.error("[browse] late poll failed:", err));
  return { text: null, deferred: true, runId };
}
