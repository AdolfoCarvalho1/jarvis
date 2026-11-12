const BASE = process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/openai/v1";
const MODEL = process.env.JARVIS_VISION_MODEL || "deepseek-v4.1-flash";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0 Safari/537.36";

interface VisionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/** Envia um frame da tela ao modelo de visão e devolve a descrição em texto. */
export async function describeImage(base64: string, prompt: string, signal: AbortSignal): Promise<string> {
  const key = process.env.OPENCODE_GO_API_KEY;
  if (!key) throw new Error("OPENCODE_GO_API_KEY ausente");

  const response = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`visão ${response.status}: ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as VisionResponse;
  const text = data.choices?.[0]?.message?.content?.trim();
  return text || "(sem descrição)";
}
