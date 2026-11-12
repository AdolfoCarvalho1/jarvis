import { Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIPv4 } from "node:net";

const blocked = new BlockList();
const resolver = new Resolver({ timeout: 2_000, tries: 2 });
for (const [network, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) blocked.addSubnet(network, bits);

export async function readPublicPage(url: URL, headers: Record<string, string>, signal: AbortSignal) {
  for (let redirects = 0; redirects <= 4; redirects++) {
    signal.throwIfAborted();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))) {
      throw new Error("Use uma página HTTP ou HTTPS pública.");
    }
    const addresses = isIPv4(url.hostname) ? [url.hostname] : await resolver.resolve4(url.hostname);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((address) => blocked.check(address))) {
      throw new Error("Endereço de rede privada ou reservada.");
    }
    const address = addresses[0];
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const response = await new Promise<{ redirect?: string; status: number; type: string; raw: string }>((resolve, reject) => {
      const outgoing = request(url, {
        agent: false, family: 4, signal, headers,
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [{ address, family: 4 }]);
          else callback(null, address, 4);
        },
      }, (incoming) => {
        const status = incoming.statusCode ?? 502;
        const type = incoming.headers["content-type"] ?? "";
        const redirect = status >= 300 && status < 400 ? incoming.headers.location : undefined;
        if (redirect || status < 200 || status >= 300) {
          incoming.destroy();
          resolve({ redirect, status, type, raw: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_000_000) incoming.destroy(new Error("Página acima de 1 MB."));
          else chunks.push(chunk);
        });
        incoming.once("error", reject);
        incoming.once("end", () => resolve({ status, type, raw: Buffer.concat(chunks).toString("utf8") }));
      });
      outgoing.once("error", reject);
      outgoing.end();
    });
    if (!response.redirect) return response;
    url = new URL(response.redirect, url);
  }
  throw new Error("Limite de redirecionamentos atingido.");
}
