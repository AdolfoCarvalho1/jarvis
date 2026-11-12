export const AUTH_COOKIE = "jarvis_auth";

/** Token determinístico (não reversível) usado só como prova de que a senha foi digitada. */
export async function authToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`jarvis:${password}:v1`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
