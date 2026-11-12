// Servidor MCP mínimo para testar o cliente do J.A.R.V.I.S.
// Protocolo: uma mensagem JSON-RPC por linha no stdin/stdout.
import readline from "node:readline";

const TOOLS = [
  {
    name: "eco",
    description: "Devolve o texto recebido. Serve para testar o encanamento do MCP.",
    inputSchema: {
      type: "object",
      properties: { texto: { type: "string", description: "Texto a repetir" } },
      required: ["texto"],
    },
  },
  {
    name: "somar",
    description: "Soma dois números e devolve o resultado.",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "hora",
    description: "Hora atual do computador em ISO 8601.",
    inputSchema: { type: "object", properties: {} },
  },
];

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } })}\n`);
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  const { id, method, params } = message;

  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "jarvis-demo", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized") return;
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      if (name === "eco") {
        return reply(id, { content: [{ type: "text", text: String(args.texto ?? "") }] });
      }
      if (name === "somar") {
        const total = Number(args.a ?? 0) + Number(args.b ?? 0);
        return reply(id, { content: [{ type: "text", text: String(total) }] });
      }
      if (name === "hora") {
        return reply(id, { content: [{ type: "text", text: new Date().toISOString() }] });
      }
      return reply(id, { content: [{ type: "text", text: `ferramenta desconhecida: ${name}` }], isError: true });
    } catch (error) {
      return fail(id, error instanceof Error ? error.message : "erro");
    }
  }

  if (typeof id === "number") fail(id, `método não suportado: ${method}`);
});
