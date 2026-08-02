/**
 * Hand-rolled frontmatter parser mirroring the identity-brain tooling's own
 * parser (spec-workflow plugin's `brain.py: parse_note`/`_parse_scalar`/
 * `_split_list`) so brain notes round-trip through the same rules: bracketed
 * lists split on top-level commas (quoted commas preserved), `true`/`false`
 * booleans, bare integers, and quoted-or-bare scalar strings. No YAML
 * dependency — brain notes deliberately use this restricted subset.
 */
export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseNote(raw: string): ParsedNote {
  const frontmatter: Record<string, unknown> = {};
  let body = raw;

  if (raw.startsWith("---")) {
    const lines = raw.split("\n");
    let end: number | null = null;
    for (let idx = 1; idx < lines.length; idx++) {
      if (lines[idx].trim() === "---") {
        end = idx;
        break;
      }
    }
    if (end !== null) {
      for (const line of lines.slice(1, end)) {
        if (!line.trim() || !line.includes(":")) continue;
        const colonIdx = line.indexOf(":");
        const key = line.slice(0, colonIdx).trim();
        const rest = line.slice(colonIdx + 1).trim();
        frontmatter[key] = parseScalar(rest);
      }
      body = lines.slice(end + 1).join("\n");
      if (body.startsWith("\n")) body = body.slice(1);
    }
  }

  return { frontmatter, body };
}

function parseScalar(rest: string): unknown {
  if (rest.startsWith("[") && rest.endsWith("]")) {
    return splitList(rest.slice(1, -1));
  }
  const low = rest.toLowerCase();
  if (low === "true") return true;
  if (low === "false") return false;
  if (/^-?\d+$/.test(rest)) return parseInt(rest, 10);
  return unquote(rest);
}

function splitList(inner: string): string[] {
  const items: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ",") {
      items.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) items.push(tail);
  return items.filter((x) => x).map(unquote);
}

function unquote(s: string): string {
  if (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === '"' || s[0] === "'")) {
    return s.slice(1, -1);
  }
  return s;
}
