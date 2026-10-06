import dns from 'dns/promises';
import net from 'net';
import { domainToASCII } from 'url';

export type MailService = 'smtp' | 'imap';

export function configuredMailHostAllowlist() {
  return new Set((process.env.MAIL_ALLOWED_CUSTOM_HOSTS || '').split(',')
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean));
}

function normalizeAndValidateHost(host: string, allowedHosts: ReadonlySet<string>) {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!normalized || normalized.length > 253 || /[\s\/@?#\\]/.test(normalized)) {
    throw new Error('Invalid mail host');
  }
  if (allowedHosts.has(normalized) || net.isIP(normalized)) return normalized;
  const ascii = domainToASCII(normalized);
  if (!ascii || ascii.length > 253 || ascii.split('.').some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new Error('Invalid mail host');
  }
  return ascii;
}

export function isBlockedMailHost(host: string, allowedHosts: ReadonlySet<string> = new Set()): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!normalized || allowedHosts.has(normalized)) return false;
  if (['localhost', 'metadata.google.internal', 'metadata', 'host.docker.internal'].includes(normalized)
    || normalized.endsWith('.local') || normalized.endsWith('.internal')) return true;

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 0)
      || (octets[0] === 192 && octets[1] === 88 && octets[2] === 99)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51 && octets[2] === 100))
      || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
      || octets[0] >= 224;
  }
  if (ipVersion === 6) {
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedIpv4) return isBlockedMailHost(mappedIpv4[1], allowedHosts);
    if (normalized.startsWith('::ffff:')) return true;
    // Publicly routable IPv6 unicast addresses are in 2000::/3. Expand the
    // address before checking special-use subranges so compressed and full
    // forms receive the same treatment.
    const halves = normalized.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const groups = halves.length === 2
      ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
      : left;
    if (groups.length !== 8) return true;
    const first = Number.parseInt(groups[0], 16);
    const second = Number.parseInt(groups[1], 16);
    const isGlobalUnicast = first >= 0x2000 && first <= 0x3fff;
    const isDocumentation = first === 0x2001 && second === 0x0db8;
    const isSpecial2001 = first === 0x2001 && second <= 0x01ff;
    const isSixToFour = first === 0x2002;
    return !isGlobalUnicast || isDocumentation || isSpecial2001 || isSixToFour;
  }
  return false;
}

export async function assertPublicMailHost(
  host: string,
  allowedHosts: ReadonlySet<string> = new Set(),
  lookup: typeof dns.lookup = dns.lookup,
): Promise<void> {
  const normalized = normalizeAndValidateHost(host, allowedHosts);
  if (isBlockedMailHost(normalized, allowedHosts)) throw new Error('Custom mail hosts must be public or explicitly allowlisted');
  if (allowedHosts.has(normalized) || net.isIP(normalized)) return;

  // Check every A/AAAA answer; validating just one answer allows a mixed public/private DNS record set.
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedMailHost(address, allowedHosts))) {
    throw new Error('Custom mail host resolves to a private or reserved address');
  }
}

export async function assertMailEndpointSafe(
  service: MailService,
  host: string,
  port: number | string,
  allowedHosts: ReadonlySet<string> = configuredMailHostAllowlist(),
): Promise<void> {
  if (process.env.NODE_ENV !== 'production' && process.env.MAIL_ENFORCE_PUBLIC_HOSTS !== 'true') return;
  const normalizedPort = Number(port);
  const allowedPorts = service === 'smtp' ? new Set([25, 465, 587, 2525]) : new Set([143, 993]);
  if (!Number.isInteger(normalizedPort) || !allowedPorts.has(normalizedPort)) {
    throw new Error(`Unsupported ${service.toUpperCase()} port`);
  }
  await assertPublicMailHost(host, allowedHosts);
}

export async function assertMailEndpointsSafe(
  endpoints: { smtpHost?: string; smtpPort?: number | string; imapHost?: string; imapPort?: number | string },
  allowedHosts: ReadonlySet<string> = configuredMailHostAllowlist(),
) {
  const checks: Promise<void>[] = [];
  if (endpoints.smtpHost?.trim()) checks.push(assertMailEndpointSafe('smtp', endpoints.smtpHost, endpoints.smtpPort || 587, allowedHosts));
  if (endpoints.imapHost?.trim()) checks.push(assertMailEndpointSafe('imap', endpoints.imapHost, endpoints.imapPort || 993, allowedHosts));
  await Promise.all(checks);
}
