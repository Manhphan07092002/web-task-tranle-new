import { ImapFlow } from 'imapflow';
import { isIP } from 'node:net';
import { mailTlsOptions } from './mailTls.js';

interface ImapConnectionOptions {
  host: string;
  port: number;
  email: string;
  password: string;
  allowUsernameFallback?: boolean;
}

export async function connectImapMailbox(options: ImapConnectionOptions): Promise<ImapFlow> {
  const connect = async (user: string) => {
    const client = new ImapFlow({
      host: options.host,
      port: options.port,
      servername: isIP(options.host) ? undefined : options.host,
      secure: options.port === 993,
      ...(options.port === 993 ? {} : { doSTARTTLS: true }),
      auth: { user, pass: options.password },
      tls: mailTlsOptions(),
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
    });
    // Socket failures are also reported through connect() and mailbox operations.
    client.on('error', () => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('IMAP connection timed out'), { code: 'ETIMEDOUT' })), 15000);
        }),
      ]);
      return client;
    } catch (error) {
      client.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await connect(options.email);
  } catch (error: any) {
    if (options.allowUsernameFallback && error.authenticationFailed === true && options.email.includes('@')) {
      return connect(options.email.split('@')[0]);
    }
    throw error;
  }
}
