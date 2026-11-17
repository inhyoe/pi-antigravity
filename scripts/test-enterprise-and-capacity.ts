import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { checkPublicUrl } from "../src/utils/address.js";
import {
  enterpriseStreamUrl,
  resolveEnterpriseTarget,
  toEnterpriseGenerateBody,
} from "../src/client/enterprise.js";
import { advertisedSiblingRuntimes, siblingRuntimeModels } from "../src/models/models.js";
import { endpointCandidates } from "../src/client/client.js";
import {
  clearCapacityRouteCache,
  isGenericResourceExhausted,
  rememberCapacityRoute,
  rememberedCapacityRoute,
  resolveCapacityCandidates,
  streamAntigravity,
} from "../src/stream/stream.js";
import { ANTIGRAVITY_MODELS } from "../src/models/index.js";
import type { AntigravityGenerateRequest } from "../src/types/types.js";

const home = mkdtempSync(join(tmpdir(), "antigravity-home-"));
const saved = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  NO_PREWARM: process.env.ANTIGRAVITY_NO_PREWARM,
  LOCATION: process.env.ANTIGRAVITY_LOCATION,
  ENTERPRISE: process.env.ANTIGRAVITY_ENTERPRISE,
  PROJECT: process.env.ANTIGRAVITY_ENTERPRISE_PROJECT,
  TIER: process.env.ANTIGRAVITY_USER_TIER,
  BASE_URL: process.env.ANTIGRAVITY_BASE_URL,
  RUNTIME_MODEL: process.env.ANTIGRAVITY_RUNTIME_MODEL,
  NOAGY_BASE_URL: process.env.NOAGY_BASE_URL,
  NOAGY_RUNTIME_MODEL: process.env.NOAGY_RUNTIME_MODEL,
};
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.ANTIGRAVITY_NO_PREWARM = "1";
delete process.env.ANTIGRAVITY_LOCATION;
delete process.env.ANTIGRAVITY_ENTERPRISE;
delete process.env.ANTIGRAVITY_ENTERPRISE_PROJECT;
delete process.env.ANTIGRAVITY_USER_TIER;
delete process.env.ANTIGRAVITY_BASE_URL;
delete process.env.ANTIGRAVITY_RUNTIME_MODEL;
delete process.env.NOAGY_BASE_URL;
delete process.env.NOAGY_RUNTIME_MODEL;

assert.equal(resolveEnterpriseTarget(), undefined);
process.env.ANTIGRAVITY_LOCATION = "eu";
assert.throws(() => resolveEnterpriseTarget(), /consumer endpoint/);
process.env.ANTIGRAVITY_ENTERPRISE_PROJECT = "not a project";
assert.throws(() => resolveEnterpriseTarget(), /project id/);
process.env.ANTIGRAVITY_ENTERPRISE_PROJECT = "enterprise-project-1";
assert.throws(() => resolveEnterpriseTarget(), /USER_TIER/);
process.env.ANTIGRAVITY_USER_TIER = "gcp-ge-standard";
const target = resolveEnterpriseTarget();
assert.ok(target);
assert.equal(target?.host, "https://businessaicode.eu.rep.googleapis.com");
assert.equal(
  enterpriseStreamUrl(target!),
  "https://businessaicode.eu.rep.googleapis.com/v1beta/projects/enterprise-project-1/locations/eu:streamGenerateContent?alt=sse",
);
const envelope = {
  project: "consumer-project",
  model: "gemini-3.8-flash-high",
  request: {
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    systemInstruction: { role: "user", parts: [{ text: "sys" }] },
    sessionId: "secret-session",
  },
  requestType: "agent",
  userAgent: "antigravity",
  requestId: "req",
} as AntigravityGenerateRequest;
const enterpriseBody = toEnterpriseGenerateBody(envelope, target!);
assert.equal("project" in enterpriseBody, false);
assert.equal("sessionId" in (enterpriseBody as { request?: object }), false);
assert.deepEqual(enterpriseBody.aicode, { experience: "gemini-3.8-flash-high" });
assert.deepEqual(enterpriseBody.entitlement, { userTier: "gcp-ge-standard" });
assert.equal((enterpriseBody as { contents?: unknown }).contents, envelope.request.contents);
delete process.env.ANTIGRAVITY_LOCATION;
delete process.env.ANTIGRAVITY_ENTERPRISE_PROJECT;
delete process.env.ANTIGRAVITY_USER_TIER;

assert.deepEqual(siblingRuntimeModels("gemini-3.8-flash-low").slice(0, 2), [
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium",
]);
assert.ok(advertisedSiblingRuntimes("gemini-3.8-flash-low").includes("gemini-3.8-flash-high"));
assert.deepEqual(siblingRuntimeModels("gemini-4-argon-high").slice(0, 1), ["gemini-4-argon-medium"]);
assert.deepEqual(siblingRuntimeModels("gemini-4-hydrogen-xhigh").slice(0, 2), [
  "gemini-4-hydrogen-high",
  "gemini-4-hydrogen-medium",
]);
assert.deepEqual(endpointCandidates(), [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
]);
assert.equal(isGenericResourceExhausted("Resource has been exhausted (e.g. check quota)."), true);
assert.equal(isGenericResourceExhausted("Quota exceeded. Resets in 2h"), false);
assert.equal(checkPublicUrl("http://127.1/").ok, false);
assert.equal(checkPublicUrl("http://0x7f000001/").ok, false);
assert.equal(checkPublicUrl("https://example.com/docs").ok, true);

const savedFetch = globalThis.fetch;
const model = {
  ...ANTIGRAVITY_MODELS.find((entry) => entry.id === "gemini-3.8-flash"),
  api: "antigravity",
  provider: "antigravity",
} as Model<Api>;
const options = {
  apiKey: JSON.stringify({ token: "test-token", projectId: "test-project" }),
  sessionId: "capacity-test",
};
try {
  const seen: { url: string; model?: string; marker?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string; marker?: string };
    seen.push({ url: String(url), model: payload.model, marker: payload.marker });
    if (payload.model !== "gemini-3.8-flash-high") {
      return new Response(
        JSON.stringify({
          error: { message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" },
        }),
        { status: 429 },
      );
    }
    assert.equal(payload.marker, "from-extension");
    return new Response(
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}}\n\ndata: [DONE]\n\n',
    );
  }) as typeof fetch;
  const result = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    {
      ...options,
      reasoning: "off",
      onPayload: (payload) => ({ ...(payload as object), marker: "from-extension" }),
    },
  ).result();
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.ok(
    seen.some((call) => call.model === "gemini-3.8-flash-low"),
    `expected a low-tier attempt, saw ${JSON.stringify(seen)}`,
  );
  assert.ok(
    seen.some((call) => call.model === "gemini-3.8-flash-high" && call.marker === "from-extension"),
    `expected a high-tier retry, saw ${JSON.stringify(seen)}`,
  );
  assert.ok(seen.every((call) => !String(call.url).includes("businessaicode")));
  assert.ok(seen.every((call) => call.marker === "from-extension"));

  process.env.ANTIGRAVITY_LOCATION = "eu";
  process.env.ANTIGRAVITY_ENTERPRISE_PROJECT = "enterprise-project-1";
  process.env.ANTIGRAVITY_USER_TIER = "gcp-ge-standard";
  const enterpriseCalls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    enterpriseCalls.push(String(url));
    const payload = JSON.parse(String(init?.body)) as { aicode?: { experience?: string }; project?: string };
    assert.equal(payload.project, undefined);
    assert.equal(payload.aicode?.experience, "gemini-3.8-flash-high");
    const headers = new Headers(init?.headers);
    assert.match(headers.get("user-agent") || headers.get("User-Agent") || "", /auth_method=gcp/);
    return new Response(
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"eu"}]},"finishReason":"STOP"}]}}\n\ndata: [DONE]\n\n',
    );
  }) as typeof fetch;
  const regional = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    { ...options, reasoning: "high" },
  ).result();
  assert.equal(regional.stopReason, "stop", regional.errorMessage);
  assert.equal(enterpriseCalls.length, 1);
  assert.match(enterpriseCalls[0] || "", /^https:\/\/businessaicode\.eu\.rep\.googleapis\.com\/v1beta\/projects\/enterprise-project-1\/locations\/eu:streamGenerateContent/);

  // Cross-turn capacity route memory: turn 1 walks -high (generic 429 on all
  // endpoints) to -medium; turn 2 must go straight to -medium in one fetch
  // with the un-mutated sessionId (nonce 0); turn 3 evicts a stale cached
  // -medium when it 429s and -high has recovered.
  delete process.env.ANTIGRAVITY_LOCATION;
  delete process.env.ANTIGRAVITY_ENTERPRISE_PROJECT;
  delete process.env.ANTIGRAVITY_USER_TIER;
  clearCapacityRouteCache();
  const okSse = (text: string) =>
    new Response(
      `data: {"response":{"candidates":[{"content":{"parts":[{"text":"${text}"}]},"finishReason":"STOP"}]}}\n\ndata: [DONE]\n\n`,
    );
  const generic429 = () =>
    new Response(
      JSON.stringify({
        error: { message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" },
      }),
      { status: 429 },
    );
  let liveModel = "gemini-3.8-flash-medium";
  const multiCalls: { url: string; model?: string; sessionId?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as {
      model?: string;
      request?: { sessionId?: string };
    };
    multiCalls.push({ url: String(url), model: payload.model, sessionId: payload.request?.sessionId });
    return payload.model === liveModel ? okSse("turn") : generic429();
  }) as typeof fetch;
  const multiOpts = { ...options, sessionId: "sess-1", reasoning: "high" as const };
  const turn1 = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    multiOpts,
  ).result();
  assert.equal(turn1.stopReason, "stop", turn1.errorMessage);
  const turn1Calls = [...multiCalls];
  assert.ok(turn1Calls.length > 1, `turn 1 should walk endpoints/tiers, saw ${JSON.stringify(turn1Calls)}`);
  assert.equal(turn1Calls.at(-1)?.model, "gemini-3.8-flash-medium");
  const turn1InitialSessionId = turn1Calls[0]?.sessionId;
  assert.ok(turn1InitialSessionId);

  multiCalls.length = 0;
  const turn2 = await streamAntigravity(
    model,
    {
      messages: [
        { role: "user", content: "hi", timestamp: 1 },
        turn1,
        { role: "user", content: "again", timestamp: 2 },
      ],
    },
    multiOpts,
  ).result();
  assert.equal(turn2.stopReason, "stop", turn2.errorMessage);
  assert.equal(multiCalls.length, 1, `turn 2 should make exactly 1 fetch, saw ${JSON.stringify(multiCalls)}`);
  assert.equal(multiCalls[0]?.model, "gemini-3.8-flash-medium");
  assert.equal(multiCalls[0]?.sessionId, turn1InitialSessionId);

  liveModel = "gemini-3.8-flash-high";
  multiCalls.length = 0;
  const turn3 = await streamAntigravity(
    model,
    {
      messages: [
        { role: "user", content: "hi", timestamp: 1 },
        turn1,
        { role: "user", content: "again", timestamp: 2 },
        turn2,
        { role: "user", content: "third", timestamp: 3 },
      ],
    },
    multiOpts,
  ).result();
  assert.equal(turn3.stopReason, "stop", turn3.errorMessage);
  assert.equal(
    multiCalls.length,
    2,
    `turn 3 should probe cached (medium, daily) once then recovered (high, daily), saw ${JSON.stringify(multiCalls)}`,
  );
  assert.equal(multiCalls[0]?.model, "gemini-3.8-flash-medium");
  assert.match(multiCalls[0]?.url || "", /^https:\/\/daily-cloudcode-pa\.googleapis\.com\//);
  assert.equal(multiCalls[1]?.model, "gemini-3.8-flash-high");
  assert.match(multiCalls[1]?.url || "", /^https:\/\/daily-cloudcode-pa\.googleapis\.com\//);
  clearCapacityRouteCache();

  // Transport throw on the cached probe evicts it and recovers on the
  // initial runtime in the same turn, without trying other endpoints first.
  const transportRouteKey = resolveCapacityCandidates(
    { token: "test-token", projectId: "test-project" },
    "test-project",
    "gemini-3.8-flash-high",
    "high",
    true,
  ).routeKey;
  rememberCapacityRoute(
    transportRouteKey,
    "gemini-3.8-flash-medium",
    "https://daily-cloudcode-pa.googleapis.com",
  );
  const transportCalls: { url: string; model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    transportCalls.push({ url: String(url), model: payload.model });
    if (payload.model === "gemini-3.8-flash-medium") throw new Error("socket hang up");
    return payload.model === "gemini-3.8-flash-high" ? okSse("recovered") : generic429();
  }) as typeof fetch;
  const transportTurn = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    { ...options, sessionId: "sess-transport", reasoning: "high" as const },
  ).result();
  assert.equal(transportTurn.stopReason, "stop", transportTurn.errorMessage);
  assert.equal(
    transportCalls.length,
    2,
    `cached transport failure should recover in 2 fetches, saw ${JSON.stringify(transportCalls)}`,
  );
  assert.equal(transportCalls[0]?.model, "gemini-3.8-flash-medium");
  assert.match(transportCalls[0]?.url || "", /^https:\/\/daily-cloudcode-pa\.googleapis\.com\//);
  assert.equal(transportCalls[1]?.model, "gemini-3.8-flash-high");
  assert.match(transportCalls[1]?.url || "", /^https:\/\/daily-cloudcode-pa\.googleapis\.com\//);
  assert.equal(rememberedCapacityRoute(transportRouteKey), undefined, "cached route evicted");

  // Env-override turns must not pollute preferredCapacityRoutes: a capacity
  // walk under ANTIGRAVITY_BASE_URL succeeds on the proxy via a sibling tier
  // (which would otherwise be remembered with the proxy endpoint), so the
  // next normal turn must still start on the normal (daily) endpoint.
  clearCapacityRouteCache();
  // assertSafeApiBaseUrl only allows *.googleapis.com hosts, so the custom
  // endpoint uses that suffix while staying distinct from the daily default.
  process.env.ANTIGRAVITY_BASE_URL = "https://custom-proxy.googleapis.com";
  const proxyCalls: { url: string; model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    proxyCalls.push({ url: String(url), model: payload.model });
    return payload.model === "gemini-3.8-flash-medium" ? okSse("proxy") : generic429();
  }) as typeof fetch;
  const proxyTurn = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    { ...options, sessionId: "sess-proxy", reasoning: "high" as const },
  ).result();
  assert.equal(proxyTurn.stopReason, "stop", proxyTurn.errorMessage);
  assert.ok(proxyCalls.length > 0, "proxy turn should fetch");
  assert.equal(proxyCalls[0]?.model, "gemini-3.8-flash-high");
  assert.equal(proxyCalls.at(-1)?.model, "gemini-3.8-flash-medium");
  assert.ok(
    proxyCalls.every((call) => call.url.startsWith("https://custom-proxy.googleapis.com/")),
    `proxy turn should only hit custom-proxy.googleapis.com, saw ${JSON.stringify(proxyCalls)}`,
  );
  assert.equal(
    rememberedCapacityRoute(transportRouteKey),
    undefined,
    "BASE_URL turn must not populate the capacity route cache",
  );
  delete process.env.ANTIGRAVITY_BASE_URL;

  const normalCalls: { url: string; model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    normalCalls.push({ url: String(url), model: payload.model });
    return okSse("normal");
  }) as typeof fetch;
  const normalTurn = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    { ...options, sessionId: "sess-after-proxy", reasoning: "high" as const },
  ).result();
  assert.equal(normalTurn.stopReason, "stop", normalTurn.errorMessage);
  assert.equal(normalCalls.length, 1, `normal turn should make exactly 1 fetch, saw ${JSON.stringify(normalCalls)}`);
  assert.equal(normalCalls[0]?.model, "gemini-3.8-flash-high");
  assert.match(normalCalls[0]?.url || "", /^https:\/\/daily-cloudcode-pa\.googleapis\.com\//);
  assert.ok(normalCalls.every((call) => !call.url.includes("custom-proxy.googleapis.com")));

  // Same for ANTIGRAVITY_RUNTIME_MODEL: the overridden -low tier walks to a
  // sibling, but that route must not be remembered once the override is gone.
  clearCapacityRouteCache();
  process.env.ANTIGRAVITY_RUNTIME_MODEL = "gemini-3.8-flash-low";
  const runtimeCalls: { url: string; model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    runtimeCalls.push({ url: String(url), model: payload.model });
    return payload.model === "gemini-3.8-flash-high" ? okSse("runtime") : generic429();
  }) as typeof fetch;
  const runtimeTurn = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    { ...options, sessionId: "sess-runtime-model", reasoning: "high" as const },
  ).result();
  assert.equal(runtimeTurn.stopReason, "stop", runtimeTurn.errorMessage);
  assert.equal(runtimeCalls[0]?.model, "gemini-3.8-flash-low");
  assert.equal(runtimeCalls.at(-1)?.model, "gemini-3.8-flash-high");
  delete process.env.ANTIGRAVITY_RUNTIME_MODEL;
  assert.equal(
    rememberedCapacityRoute(transportRouteKey),
    undefined,
    "RUNTIME_MODEL turn must not populate the capacity route cache",
  );
  clearCapacityRouteCache();

  // Two accounts sharing projectId, model, and effort must not share a
  // cached capacity route: A falls back to -medium, B still tries -high
  // first, and A's next turn still hits its cached -medium in 1 fetch.
  clearCapacityRouteCache();
  const acctCalls: { auth: string; model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    const auth = new Headers(init?.headers).get("authorization") || "";
    acctCalls.push({ auth, model: payload.model });
    if (auth === "Bearer tok-a") {
      return payload.model === "gemini-3.8-flash-medium" ? okSse("a") : generic429();
    }
    return payload.model === "gemini-3.8-flash-high" ? okSse("b") : generic429();
  }) as typeof fetch;
  const acctA = {
    apiKey: JSON.stringify({ token: "tok-a", projectId: "shared-proj" }),
    sessionId: "sess-acct-a",
    reasoning: "high" as const,
  };
  const acctB = {
    apiKey: JSON.stringify({ token: "tok-b", projectId: "shared-proj" }),
    sessionId: "sess-acct-b",
    reasoning: "high" as const,
  };
  const aTurn1 = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    acctA,
  ).result();
  assert.equal(aTurn1.stopReason, "stop", aTurn1.errorMessage);
  assert.ok(acctCalls.length > 1, `account A should walk to -medium, saw ${JSON.stringify(acctCalls)}`);
  assert.equal(acctCalls[0]?.model, "gemini-3.8-flash-high");
  assert.equal(acctCalls.at(-1)?.model, "gemini-3.8-flash-medium");
  acctCalls.length = 0;
  const bTurn1 = await streamAntigravity(
    model,
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    acctB,
  ).result();
  assert.equal(bTurn1.stopReason, "stop", bTurn1.errorMessage);
  assert.equal(acctCalls.length, 1, `account B should not consume A's cached route, saw ${JSON.stringify(acctCalls)}`);
  assert.equal(acctCalls[0]?.model, "gemini-3.8-flash-high");
  acctCalls.length = 0;
  const aTurn2 = await streamAntigravity(
    model,
    {
      messages: [
        { role: "user", content: "hi", timestamp: 1 },
        aTurn1,
        { role: "user", content: "again", timestamp: 2 },
      ],
    },
    acctA,
  ).result();
  assert.equal(aTurn2.stopReason, "stop", aTurn2.errorMessage);
  assert.equal(acctCalls.length, 1, `account A turn 2 should use its cached route in 1 fetch, saw ${JSON.stringify(acctCalls)}`);
  assert.equal(acctCalls[0]?.model, "gemini-3.8-flash-medium");
  clearCapacityRouteCache();

  // Scenario 1 (F2): cached medium@daily fails, high generic-429s on both
  // endpoints, but medium@prod works — the standard chain must still offer
  // medium even though the probe slot already used that runtime id.
  clearCapacityRouteCache();
  rememberCapacityRoute(transportRouteKey, "gemini-3.8-flash-medium", "https://daily-cloudcode-pa.googleapis.com");
  const s1Calls: { url: string; model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    s1Calls.push({ url: String(url), model: payload.model });
    if (payload.model === "gemini-3.8-flash-medium" && String(url).startsWith("https://cloudcode-pa.googleapis.com/")) {
      return okSse("prod-medium");
    }
    return generic429();
  }) as typeof fetch;
  const s1 = await streamAntigravity(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { ...options, sessionId: "sess-s1", reasoning: "high" as const }).result();
  assert.equal(s1.stopReason, "stop", s1.errorMessage);
  assert.equal(s1Calls[0]?.model, "gemini-3.8-flash-medium", "scenario1 first call is cached probe");
  assert.match(s1Calls[0]?.url || "", /^https:\/\/daily-cloudcode-pa\.googleapis\.com\//);
  assert.equal(s1Calls.at(-1)?.model, "gemini-3.8-flash-medium", `scenario1 should recover via medium@prod, saw ${JSON.stringify(s1Calls)}`);
  assert.match(s1Calls.at(-1)?.url || "", /^https:\/\/cloudcode-pa\.googleapis\.com\//);
  clearCapacityRouteCache();

  const sseError = () =>
    new Response('data: {"error":{"code":503,"message":"No capacity available","status":"UNAVAILABLE"}}\n\n');

  // Scenario 2 (F3): medium returns HTTP 200 but an SSE error — its route
  // must not be remembered, so the next turn starts on high again.
  clearCapacityRouteCache();
  const s2Calls: { model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    s2Calls.push({ model: payload.model });
    return payload.model === "gemini-3.8-flash-medium" ? sseError() : generic429();
  }) as typeof fetch;
  const s2 = await streamAntigravity(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { ...options, sessionId: "sess-s2", reasoning: "high" as const }).result();
  assert.equal(s2.stopReason, "error", `scenario2 SSE error turn should fail, saw ${s2.stopReason}`);
  assert.equal(rememberedCapacityRoute(transportRouteKey), undefined, "scenario2 SSE-error route must not be cached");
  s2Calls.length = 0;
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    s2Calls.push({ model: payload.model });
    return okSse("next");
  }) as typeof fetch;
  const s2Next = await streamAntigravity(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { ...options, sessionId: "sess-s2-next", reasoning: "high" as const }).result();
  assert.equal(s2Next.stopReason, "stop", s2Next.errorMessage);
  assert.equal(s2Calls[0]?.model, "gemini-3.8-flash-high", "scenario2 next turn must start on initial runtime");
  clearCapacityRouteCache();

  // Scenario 3 (F3 invalidate): a remembered probe that 200s then SSE-errors
  // must evict its cached route.
  rememberCapacityRoute(transportRouteKey, "gemini-3.8-flash-medium", "https://daily-cloudcode-pa.googleapis.com");
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    return payload.model === "gemini-3.8-flash-medium" ? sseError() : okSse("high");
  }) as typeof fetch;
  const s3 = await streamAntigravity(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { ...options, sessionId: "sess-s3", reasoning: "high" as const }).result();
  assert.equal(s3.stopReason, "error", `scenario3 probe SSE error should fail the turn, saw ${s3.stopReason}`);
  assert.equal(rememberedCapacityRoute(transportRouteKey), undefined, "scenario3 cached route must be invalidated on stream failure");
  clearCapacityRouteCache();

  // Scenario 4 (F4): cached probe 503s and its body read throws — the turn
  // must continue to the initial runtime and the cache must be evicted.
  rememberCapacityRoute(transportRouteKey, "gemini-3.8-flash-medium", "https://daily-cloudcode-pa.googleapis.com");
  const s4Calls: { url: string; model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    s4Calls.push({ url: String(url), model: payload.model });
    if (payload.model === "gemini-3.8-flash-medium") {
      return new Response(
        new ReadableStream({ pull(controller) { controller.error(new Error("body read failed")); } }),
        { status: 503 },
      );
    }
    return payload.model === "gemini-3.8-flash-high" ? okSse("recovered") : generic429();
  }) as typeof fetch;
  const s4 = await streamAntigravity(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { ...options, sessionId: "sess-s4", reasoning: "high" as const }).result();
  assert.equal(s4.stopReason, "stop", s4.errorMessage);
  assert.equal(s4Calls.length, 2, `scenario4 should probe then recover on high, saw ${JSON.stringify(s4Calls)}`);
  assert.equal(s4Calls[1]?.model, "gemini-3.8-flash-high");
  assert.equal(rememberedCapacityRoute(transportRouteKey), undefined, "scenario4 cached route must be evicted");
  clearCapacityRouteCache();

  // Scenario 5 (regression): normal walk high 429 -> medium 200 STOP still
  // remembers the route; caller abort still propagates without fallback.
  const s5Calls: { model?: string }[] = [];
  globalThis.fetch = (async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as { model?: string };
    s5Calls.push({ model: payload.model });
    return payload.model === "gemini-3.8-flash-medium" ? okSse("walk") : generic429();
  }) as typeof fetch;
  const s5 = await streamAntigravity(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { ...options, sessionId: "sess-s5", reasoning: "high" as const }).result();
  assert.equal(s5.stopReason, "stop", s5.errorMessage);
  assert.deepEqual(rememberedCapacityRoute(transportRouteKey), { runtimeModel: "gemini-3.8-flash-medium", endpoint: "https://daily-cloudcode-pa.googleapis.com" }, "scenario5 successful walk must be remembered");
  s5Calls.length = 0;
  const s5Next = await streamAntigravity(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { ...options, sessionId: "sess-s5-next", reasoning: "high" as const }).result();
  assert.equal(s5Next.stopReason, "stop", s5Next.errorMessage);
  assert.equal(s5Calls[0]?.model, "gemini-3.8-flash-medium", "scenario5 next turn must start on remembered route");
  clearCapacityRouteCache();
  const abortController = new AbortController();
  let abortFetches = 0;
  globalThis.fetch = (async () => {
    abortFetches += 1;
    abortController.abort();
    throw new Error("caller cancelled");
  }) as typeof fetch;
  const s5Abort = await streamAntigravity(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { ...options, sessionId: "sess-s5-abort", reasoning: "high" as const, signal: abortController.signal }).result();
  assert.equal(s5Abort.stopReason, "aborted", `scenario5 caller abort must propagate, saw ${s5Abort.stopReason}: ${s5Abort.errorMessage}`);
  assert.match(s5Abort.errorMessage || "", /caller cancelled/);
  assert.equal(abortFetches, 1, "scenario5 caller abort must not fall through to other endpoints");
  clearCapacityRouteCache();

  // Deterministic TTL expiry and 64-entry FIFO cap.
  clearCapacityRouteCache();
  rememberCapacityRoute("k", "m", "e", 1000);
  assert.deepEqual(rememberedCapacityRoute("k", 1000), { runtimeModel: "m", endpoint: "e" });
  assert.equal(rememberedCapacityRoute("k", 1000 + 10 * 60_000), undefined);
  clearCapacityRouteCache();
  for (let i = 0; i <= 64; i += 1) rememberCapacityRoute(`k${i}`, "m", "e", 1000);
  assert.equal(rememberedCapacityRoute("k0", 1000), undefined, "oldest entry evicted at cap");
  assert.deepEqual(rememberedCapacityRoute("k1", 1000), { runtimeModel: "m", endpoint: "e" });
  assert.deepEqual(rememberedCapacityRoute("k64", 1000), { runtimeModel: "m", endpoint: "e" });
  clearCapacityRouteCache();
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries({
    HOME: saved.HOME,
    USERPROFILE: saved.USERPROFILE,
    ANTIGRAVITY_NO_PREWARM: saved.NO_PREWARM,
    ANTIGRAVITY_LOCATION: saved.LOCATION,
    ANTIGRAVITY_ENTERPRISE: saved.ENTERPRISE,
    ANTIGRAVITY_ENTERPRISE_PROJECT: saved.PROJECT,
    ANTIGRAVITY_USER_TIER: saved.TIER,
    ANTIGRAVITY_BASE_URL: saved.BASE_URL,
    ANTIGRAVITY_RUNTIME_MODEL: saved.RUNTIME_MODEL,
    NOAGY_BASE_URL: saved.NOAGY_BASE_URL,
    NOAGY_RUNTIME_MODEL: saved.NOAGY_RUNTIME_MODEL,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("enterprise routing, sibling capacity fallback, and onPayload passed");
