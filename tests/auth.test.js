import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

let saveSession, getSession, clearSession, checkSession;

before(async () => {
  const dom = new JSDOM('<!DOCTYPE html>', { url: 'http://localhost/' });
  global.localStorage = dom.window.localStorage;
  ({ saveSession, getSession, clearSession, checkSession } = await import('../public/js/auth.js'));
});

beforeEach(() => {
  localStorage.clear();
  global.fetch = undefined;
});

test('getSession returns null when storage is empty', () => {
  assert.strictEqual(getSession(), null);
});

test('saveSession and getSession round-trip', () => {
  saveSession('sess123', { name: 'Alice', avatar: null });
  const s = getSession();
  assert.strictEqual(s.session, 'sess123');
  assert.strictEqual(s.user.name, 'Alice');
});

test('getSession returns null after TTL expires', () => {
  localStorage.setItem('ts.auth', JSON.stringify({
    session: 's', user: { name: 'X', avatar: null }, expiresAt: Date.now() - 1,
  }));
  assert.strictEqual(getSession(), null);
});

test('clearSession removes stored session', () => {
  saveSession('s', { name: 'A', avatar: null });
  clearSession();
  assert.strictEqual(getSession(), null);
});

test('checkSession returns null when storage is empty', async () => {
  const result = await checkSession();
  assert.strictEqual(result, null);
});

test('checkSession returns stored session when /auth/me returns 200', async () => {
  saveSession('valid-session', { name: 'Bob', avatar: null });
  let capturedHeaders;
  global.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return { status: 200, ok: true };
  };
  const s = await checkSession();
  assert.strictEqual(s.session, 'valid-session');
  assert.strictEqual(capturedHeaders['X-Seerr-Session'], 'valid-session');
});

test('checkSession clears session and returns null on 401', async () => {
  saveSession('bad-session', { name: 'Eve', avatar: null });
  global.fetch = async () => ({ status: 401, ok: false });
  const s = await checkSession();
  assert.strictEqual(s, null);
  assert.strictEqual(getSession(), null);
});

test('checkSession returns stored session when fetch throws (offline)', async () => {
  saveSession('offline-session', { name: 'Bob', avatar: null });
  global.fetch = async () => { throw new Error('network error'); };
  const s = await checkSession();
  assert.strictEqual(s.session, 'offline-session');
});
