import { ImapFlow } from 'imapflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectImapMailbox } from '../utils/imapConnection.js';

const mock = vi.hoisted(() => ({
  outcomes: [] as Array<() => Promise<void>>,
  clients: [] as Array<{ close: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }>,
}));

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(function () {
    const client = {
      connect: vi.fn(mock.outcomes.shift() || (() => Promise.resolve())),
      close: vi.fn(),
      on: vi.fn(),
    };
    mock.clients.push(client);
    return client;
  }),
}));

const options = { host: 'mail.tranlecorp.com.vn', port: 993, email: 'user@example.test', password: 'dummy"pass\\word@' };
const authError = () => Object.assign(new Error('Command failed'), { authenticationFailed: true });

describe('IMAP connection lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.outcomes.length = 0;
    mock.clients.length = 0;
    vi.stubEnv('MAIL_ALLOW_INSECURE_TLS', 'false');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('sends hostname SNI and preserves certificate verification and full credentials', async () => {
    const client = await connectImapMailbox(options);
    expect(ImapFlow).toHaveBeenCalledWith(expect.objectContaining({
      host: options.host, servername: options.host, port: 993, secure: true,
      auth: { user: options.email, pass: options.password },
      tls: { rejectUnauthorized: true }, logger: false,
    }));
    expect(vi.mocked(ImapFlow).mock.calls[0][0]).not.toHaveProperty('doSTARTTLS');
    expect(client).toBe(mock.clients[0]);
    expect(mock.clients[0].close).not.toHaveBeenCalled();
    expect(mock.clients[0].on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('requires STARTTLS on port 143', async () => {
    await connectImapMailbox({ ...options, port: 143 });
    expect(ImapFlow).toHaveBeenCalledWith(expect.objectContaining({ secure: false, doSTARTTLS: true, servername: options.host }));
  });

  it('does not send an IP literal as SNI', async () => {
    await connectImapMailbox({ ...options, host: '8.8.8.8' });
    expect(ImapFlow).toHaveBeenCalledWith(expect.objectContaining({ servername: undefined }));
  });

  it('does not retry a denied login unless username fallback is explicitly enabled', async () => {
    mock.outcomes.push(() => Promise.reject(authError()));
    await expect(connectImapMailbox(options)).rejects.toMatchObject({ authenticationFailed: true });
    expect(ImapFlow).toHaveBeenCalledTimes(1);
    expect(mock.clients[0].close).toHaveBeenCalledTimes(1);
  });

  it('retries once with username only for compatible providers', async () => {
    mock.outcomes.push(() => Promise.reject(authError()));
    await connectImapMailbox({ ...options, allowUsernameFallback: true });
    expect(ImapFlow).toHaveBeenCalledTimes(2);
    expect(ImapFlow).toHaveBeenLastCalledWith(expect.objectContaining({ auth: { user: 'user', pass: options.password } }));
    expect(mock.clients[0].close).toHaveBeenCalledTimes(1);
    expect(mock.clients[1].close).not.toHaveBeenCalled();
  });

  it('rejects and closes both denied attempts without waiting for a timeout', async () => {
    mock.outcomes.push(() => Promise.reject(authError()), () => Promise.reject(authError()));
    await expect(connectImapMailbox({ ...options, allowUsernameFallback: true })).rejects.toMatchObject({ authenticationFailed: true });
    expect(ImapFlow).toHaveBeenCalledTimes(2);
    for (const client of mock.clients) expect(client.close).toHaveBeenCalledTimes(1);
  });

  it.each(['ERR_TLS_CERT_ALTNAME_INVALID', 'ECONNREFUSED', 'ETIMEDOUT'])(
    'preserves %s without a username retry', async (code) => {
      mock.outcomes.push(() => Promise.reject(Object.assign(new Error('upstream failure'), { code })));
      await expect(connectImapMailbox({ ...options, allowUsernameFallback: true })).rejects.toMatchObject({ code });
      expect(ImapFlow).toHaveBeenCalledTimes(1);
      expect(mock.clients[0].close).toHaveBeenCalledTimes(1);
    },
  );

  it('closes a stalled authentication attempt after the absolute deadline', async () => {
    vi.useFakeTimers();
    mock.outcomes.push(() => new Promise(() => {}));
    const assertion = expect(connectImapMailbox(options)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(mock.clients[0].close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline after a successful connection', async () => {
    vi.useFakeTimers();
    await connectImapMailbox(options);
    expect(vi.getTimerCount()).toBe(0);
  });
});
