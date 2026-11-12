const NEGATIVE = [
  /\berro\b/,
  /\bfalha\b/,
  /\bfalhou\b/,
  /\bproblema\b/,
  /\bimpossível\b/,
  /\bnão consigo\b/,
  /\bnão posso\b/,
  /\bnão encontrei\b/,
  /\bnão foi possível\b/,
  /\bindisponível\b/,
  /\binfelizmente\b/,
  /\bdesculpe\b/,
  /\bnegado\b/,
  /\binválid/,
  /\bbloquead/,
  /\bcaptcha\b/,
  /\bsem resultado\b/,
  /\bnão sei\b/,
];

const POSITIVE = [
  /\bpronto\b/,
  /\bfeito\b/,
  /\bconcluíd/,
  /\bsucesso\b/,
  /\bresolvid/,
  /\bfuncionando\b/,
  /\baqui está\b/,
  /\bclaro\b/,
  /\bperfeito\b/,
];

export type Sentiment = "positive" | "negative" | "neutral";

/** Leitura simples de tom para o orbe: negativa puxa vermelho; o resto, azul. */
export function sentimentOf(text: string): Sentiment {
  const lower = text.toLowerCase();
  let negative = 0;
  let positive = 0;
  for (const pattern of NEGATIVE) if (pattern.test(lower)) negative++;
  for (const pattern of POSITIVE) if (pattern.test(lower)) positive++;
  if (negative > positive) return "negative";
  if (positive > negative) return "positive";
  return "neutral";
}
