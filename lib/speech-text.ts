export function spokenText(markdown: string): string {
  return markdown
    .replace(/\x60\x60\x60[\s\S]*?(?:\x60\x60\x60|$)/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[*_\x60#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function takeSpeech(text: string, final: boolean): { phrases: string[]; rest: string } {
  const phrases: string[] = [];
  let rest = text;
  const add = (markdown: string) => {
    const clean = spokenText(markdown).slice(0, 3000);
    if (clean) phrases.push(clean);
  };

  while (rest) {
    const fence = rest.indexOf("\x60\x60\x60");
    const prose = fence < 0 ? rest : rest.slice(0, fence);
    let cursor = 0;
    for (const match of prose.matchAll(/[.!?…]+(?=\s)/g)) {
      const end = match.index + match[0].length;
      const phrase = prose.slice(cursor, end);
      if (/(?:^|\s)(?:sr|sra|dr|dra|ex|etc|\d+)\.$/i.test(phrase.trim())) continue;
      if (phrase.includes("](") && phrase.lastIndexOf("](") > phrase.lastIndexOf(")")) continue;
      add(phrase);
      cursor = end;
    }
    if (fence < 0) {
      rest = prose.slice(cursor);
      if (final) {
        add(rest);
        rest = "";
      }
      break;
    }
    add(prose.slice(cursor));
    const endFence = rest.indexOf("\x60\x60\x60", fence + 3);
    if (endFence < 0) {
      rest = final ? "" : rest.slice(fence);
      break;
    }
    rest = rest.slice(endFence + 3);
  }
  return { phrases, rest };
}
