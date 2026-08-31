import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export class SsrfError extends Error {
  override name = "SsrfError";
}

export type ApprovedUrl = {
  url: URL;
  hostname: string;
  port: number;
  addresses: string[];
};

type Lookup = typeof lookup;

export async function validatePublicUrl(raw: string, resolve: Lookup = lookup): Promise<ApprovedUrl> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SsrfError("URL is invalid."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("Only http and https URLs are allowed.");
  if (url.username || url.password) throw new SsrfError("URL credentials are not allowed.");
  if (!url.hostname || isIP(url.hostname)) throw new SsrfError("IP-literal targets are not allowed.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || !hostname.includes(".")) throw new SsrfError("Local hostnames are not allowed.");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || (port !== 80 && port !== 443)) throw new SsrfError("Only ports 80 and 443 are allowed.");

  let resolved: Awaited<ReturnType<Lookup>>;
  try { resolved = await resolve(hostname, { all: true, verbatim: true }); }
  catch { throw new SsrfError("Hostname could not be resolved."); }
  const addresses = (Array.isArray(resolved) ? resolved : [resolved]).map(entry => entry.address);
  if (addresses.length === 0 || addresses.some(address => !isPublicAddress(address))) throw new SsrfError("Hostname resolves to a non-public address.");
  return { url, hostname, port, addresses };
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) !== 6) return false;
  const hextets = parseIpv6(address);
  if (!hextets) return false;
  const mappedIpv4 = ipv4MappedAddress(hextets);
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);
  const first = hextets[0]!;
  return !(
    hextets.every(part => part === 0) ||
    hextets.slice(0, 7).every(part => part === 0) && hextets[7] === 1 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && hextets[1] === 0x0db8)
  );
}

function isPublicIpv4(address: string): boolean {
  const [a, b, c, d] = address.split(".").map(Number);
  if (![a, b, c, d].every(part => Number.isInteger(part) && part >= 0 && part <= 255)) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113));
}

function ipv4MappedAddress(hextets: number[]): string | undefined {
  if (!hextets.slice(0, 5).every(part => part === 0) || hextets[5] !== 0xffff) return undefined;
  return `${hextets[6]! >> 8}.${hextets[6]! & 0xff}.${hextets[7]! >> 8}.${hextets[7]! & 0xff}`;
}

function parseIpv6(value: string): number[] | undefined {
  if (value.includes("%")) return undefined;
  const halves = value.split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (half: string): number[] | undefined => {
    if (!half) return [];
    const parts = half.split(":");
    const output: number[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      if (part.includes(".")) {
        if (index !== parts.length - 1 || !isIP(part) || isIP(part) !== 4) return undefined;
        const [a, b, c, d] = part.split(".").map(Number);
        output.push((a << 8) | b, (c << 8) | d);
      } else if (!/^[0-9a-f]{1,4}$/i.test(part)) return undefined;
      else output.push(Number.parseInt(part, 16));
    }
    return output;
  };
  const left = parseHalf(halves[0]!); const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;
  const zeros = 8 - left.length - right.length;
  return zeros >= 1 ? [...left, ...Array(zeros).fill(0), ...right] : undefined;
}
