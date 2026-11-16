import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs the real public/sw.js in a fake ServiceWorkerGlobalScope with an
 * in-memory Cache Storage and a scriptable network.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL("../public/sw.js", import.meta.url)),
  "utf8",
);
const ORIGIN = "https://kuchsistent.vercel.app";
const CONVEX = "https://happy-otter-123.convex.cloud";

type Route = () => Response | Promise<Response>;

function html(body: string) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}
function asset(body: string) {
  return new Response(body, { headers: { "content-type": "text/javascript" } });
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function setup() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (req: string | Request) =>
    new URL(typeof req === "string" ? req : req.url, ORIGIN).href;
  const openSync = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (req: string | Request) => store.get(key(req))?.clone(),
      put: async (req: string | Request, res: Response) => void store.set(key(req), res.clone()),
      delete: async (req: string | Request) => store.delete(key(req)),
      keys: async () => [...store.keys()].map((u) => new Request(u)),
    };
  };
  const caches = {
    open: async (name: string) => openSync(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  let online = true;
  const routes = new Map<string, Route>();
  const fetched: string[] = [];
  const fetch = vi.fn(async (input: string | Request) => {
    const url = key(input);
    fetched.push(url);
    if (!online) throw new TypeError("Failed to fetch");
    const route = routes.get(url);
    return route ? route() : new Response("not found", { status: 404 });
  });

  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL(ORIGIN + "/sw.js"),
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(SOURCE, {
    self, caches, fetch, URL, Request, Response, Set, Promise, Date, setTimeout, console,
  });

  async function lifecycle(type: "install" | "activate") {
    const pending: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }

  /** Dispatches a fetch; respondWith's promise (null if not intercepted) and the event's lifetime. */
  function dispatch(url: string, mode: RequestMode, method = "GET") {
    let responded: Promise<Response> | null = null;
    const pending: Promise<unknown>[] = [];
    handlers.fetch({
      request: { url: new URL(url, ORIGIN).href, method, mode },
      respondWith: (p: Promise<Response>) => (responded = p),
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    return { responded: responded as Promise<Response> | null, pending };
  }

  /** Dispatches a fetch and waits for all its work; null if not intercepted. */
  async function request(url: string, mode: RequestMode = "no-cors", method = "GET") {
    const { responded, pending } = dispatch(url, mode, method);
    if (!responded) return null;
    const res = await responded;
    // waitUntil may be called later, while the response is being built.
    for (let i = 0; i < pending.length; i++) await pending[i];
    return res;
  }

  const cached = (name = "kuchsistent-shell-v1") =>
    [...(stores.get(name)?.keys() ?? [])].map((u) => new URL(u).pathname).sort();

  return {
    routes: (map: Record<string, Route>) => {
      for (const [path, r] of Object.entries(map)) routes.set(new URL(path, ORIGIN).href, r);
    },
    setOnline: (v: boolean) => (online = v),
    lifecycle, dispatch, request, cached, fetched, stores,
  };
}

function deploy(sw: ReturnType<typeof setup>, version: string) {
  sw.routes({
    "/plan": () => html(`<html>shell ${version}</html>`),
    "/sw-precache.json": () =>
      json({ assets: [`/assets/index-${version}.js`, `/assets/nakup-${version}.js`] }),
    [`/assets/index-${version}.js`]: () => asset(`index ${version}`),
    [`/assets/nakup-${version}.js`]: () => asset(`nakup ${version}`),
    "/site.webmanifest": () => json({ name: "Kuchsistent" }),
    "/icon-192.png": () => new Response("png"),
    "/icon-512.png": () => new Response("png"),
    "/icon.svg": () => new Response("svg"),
  });
}

describe("service worker", () => {
  let sw: ReturnType<typeof setup>;
  beforeEach(async () => {
    vi.useRealTimers();
    sw = setup();
    deploy(sw, "v1");
    await sw.lifecycle("install");
    await sw.lifecycle("activate");
  });

  it("caches the shell, every bundle and the icons on install", () => {
    expect(sw.cached()).toEqual([
      "/__shell",
      "/assets/index-v1.js",
      "/assets/nakup-v1.js",
      "/icon-192.png",
      "/icon-512.png",
      "/icon.svg",
      "/site.webmanifest",
    ]);
  });

  it("starts offline: any route gets the cached shell, bundles come from cache", async () => {
    sw.setOnline(false);
    const page = await sw.request("/nakup", "navigate");
    expect(await page!.text()).toBe("<html>shell v1</html>");
    const js = await sw.request("/assets/nakup-v1.js");
    expect(await js!.text()).toBe("nakup v1");
  });

  it("falls back to the cached shell when the network hangs", async () => {
    vi.useFakeTimers();
    sw.routes({ "/plan": () => new Promise<Response>(() => {}) });
    const { responded } = sw.dispatch("/plan", "navigate");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await (await responded!).text()).toBe("<html>shell v1</html>");
  });

  it("never touches Convex or other origins, nor non-GET requests", async () => {
    expect(await sw.request(`${CONVEX}/api/query`)).toBeNull();
    expect(await sw.request(`${CONVEX}/api/sync`, "navigate")).toBeNull();
    expect(sw.fetched.some((u) => u.startsWith(CONVEX))).toBe(false);
    expect(await sw.request("/api/anything", "cors", "POST")).toBeNull();
  });

  it("picks up a new deploy on the next launch and drops old bundles", async () => {
    deploy(sw, "v2");
    const page = await sw.request("/plan", "navigate");
    expect(await page!.text()).toBe("<html>shell v2</html>");
    expect(sw.cached()).toEqual([
      "/__shell",
      "/assets/index-v2.js",
      "/assets/nakup-v2.js",
      "/icon-192.png",
      "/icon-512.png",
      "/icon.svg",
      "/site.webmanifest",
    ]);
    sw.setOnline(false);
    const offline = await sw.request("/plan", "navigate");
    expect(await offline!.text()).toBe("<html>shell v2</html>");
  });

  it("fails to install without a shell, rather than caching nothing", async () => {
    const fresh = setup();
    await expect(fresh.lifecycle("install")).rejects.toThrow();
  });

  it("deletes caches from older service worker versions", async () => {
    const other = setup();
    other.stores.set("kuchsistent-shell-v0", new Map());
    deploy(other, "v1");
    await other.lifecycle("install");
    await other.lifecycle("activate");
    expect([...other.stores.keys()]).toEqual(["kuchsistent-shell-v1"]);
  });
});
