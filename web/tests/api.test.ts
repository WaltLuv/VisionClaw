import {beforeEach, describe, expect, it, vi} from 'vitest';
import {api, ApiError, newIdempotencyKey, setCsrf} from '../src/api';

type Call = {url: string; init: RequestInit};
let calls: Call[] = [];

function respond(body: unknown, status = 200) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return new Response(text, {status, headers: {'content-type': 'application/json'}});
}

beforeEach(() => {
  calls = [];
  setCsrf('csrf-token-value');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({url, init});
    if (status === 204) return new Response(null, {status: 204});
    return respond(payload, status);
  }));
});

let payload: unknown = {ok: true};
let status = 200;

const headersOf = (i: number) => (calls[i]!.init.headers ?? {}) as Record<string, string>;

describe('mutating requests', () => {
  beforeEach(() => {payload = {id: 'r1', task: 't', status: 'queued'}; status = 200;});

  // The gateway rejects any non-GET whose x-csrf-token does not match the
  // session, so a missing header here is an app-wide outage, not a nit.
  it('sends the CSRF token on every mutation', async () => {
    await api.execute('do it', {source: 'text', attachments: []}, 'key-1');
    expect(headersOf(0)['x-csrf-token']).toBe('csrf-token-value');
  });

  it('sends the idempotency key it was given, so a retry cannot double-submit', async () => {
    await api.execute('do it', {source: 'text', attachments: []}, 'key-1');
    expect(headersOf(0)['idempotency-key']).toBe('key-1');
  });

  it('mints a distinct idempotency key per submission', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it('keeps credentials same-origin on every call', async () => {
    await api.execute('do it', {source: 'text', attachments: []}, 'key-1');
    expect(calls[0]!.init.credentials).toBe('same-origin');
  });

  it('posts the task and context as the gateway expects', async () => {
    await api.execute('do it', {source: 'phone', attachments: ['art-1']}, 'key-1');
    expect(calls[0]!.url).toBe('/api/execute');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({task: 'do it', context: {source: 'phone', attachments: ['art-1']}});
  });
});

describe('reads', () => {
  beforeEach(() => {payload = {owner: 'alice', csrf: 'c'}; status = 200;});

  it('does not attach a CSRF token to GETs', async () => {
    await api.session();
    expect(headersOf(0)['x-csrf-token']).toBeUndefined();
  });
});

describe('uploads', () => {
  beforeEach(() => {payload = {id: 'art-1', kind: 'document', name: 'Photo.jpg'}; status = 200;});

  // The gateway reads raw bytes with express.raw() and takes the name and type
  // from headers; multipart would arrive as an unparsed buffer.
  it('sends raw bytes with the name and type in headers', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], {type: 'image/jpeg'});
    await api.upload(blob, 'Photo.jpg');
    expect(headersOf(0)['content-type']).toBe('application/octet-stream');
    expect(headersOf(0)['x-file-name']).toBe('Photo.jpg');
    expect(headersOf(0)['x-file-type']).toBe('image/jpeg');
    expect(calls[0]!.init.body).toBe(blob);
  });
});

describe('identifiers in paths', () => {
  beforeEach(() => {payload = undefined; status = 204;});

  it('escapes ids so a crafted id cannot reach another route', async () => {
    await api.cancel('../../employee-data');
    expect(calls[0]!.url).toBe('/api/runs/..%2F..%2Femployee-data/cancel');
  });
});

describe('errors', () => {
  it('surfaces the gateway message and status', async () => {
    payload = {error: {message: 'Please check the entered details.'}};
    status = 400;
    await expect(api.session()).rejects.toMatchObject({status: 400, message: 'Please check the entered details.'});
    await expect(api.session()).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to a plain message when the body is not the expected shape', async () => {
    payload = {unexpected: true};
    status = 500;
    await expect(api.session()).rejects.toMatchObject({message: 'That did not go through. Please try again.'});
  });
});
