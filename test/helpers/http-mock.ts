// Test helper for fully-offline HTTP mocking.
//
// Node's global `fetch` is backed by undici, so we use undici's own
// `MockAgent` and install it as the *global dispatcher* — every `fetch()`
// call made by code under test (e.g. src/fabtcg.ts) is transparently
// intercepted, no need to inject a client or monkeypatch `fetch` itself.
//
// Critically, `mockAgent.disableNetConnect()` is called on every install:
// any request that doesn't match a registered interceptor rejects
// immediately (fetch throws `TypeError: fetch failed`, with a `cause`
// naming the unmatched path and confirming net connect is disabled) instead
// of silently succeeding or reaching the real network. This is what makes
// "unmocked requests fail loudly" true for every test that uses this helper.
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Interceptable,
} from "undici";

export interface MockAgentHandle {
  agent: MockAgent;
  previousDispatcher: ReturnType<typeof getGlobalDispatcher>;
}

/**
 * Install a fresh MockAgent as the global dispatcher, with net connect
 * disabled. Call this in `beforeEach`; pair with `restoreHttpMock` in
 * `afterEach`.
 */
export function installHttpMock(): MockAgentHandle {
  const previousDispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return { agent, previousDispatcher };
}

/**
 * Restore the dispatcher that was active before `installHttpMock`, and
 * assert every interceptor registered on the mock agent was actually
 * consumed (so a fixture you set up but never hit fails the test too).
 */
export async function restoreHttpMock(handle: MockAgentHandle): Promise<void> {
  try {
    handle.agent.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(handle.previousDispatcher);
    await handle.agent.close();
  }
}

/**
 * Get (or create) the mock pool for a given origin, e.g.
 * `mockPool(mock, "https://fabtcg.com")`, then chain `.intercept({...}).reply(...)`.
 */
export function mockPool(
  handle: MockAgentHandle,
  origin: string,
): Interceptable {
  return handle.agent.get(origin);
}
