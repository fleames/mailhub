/** Detect a complete HTML document (doctype or <html>), vs a body fragment. */
export function looksLikeFullHtmlDocument(html: string): boolean {
  const s = html.trim();
  return /<!doctype\s+html/i.test(s) || /<html[\s>]/i.test(s);
}

/**
 * Designed / marketing email HTML that TipTap would mangle: tables, <style>
 * blocks, or a full document. Simple <p>/<b> snippets stay in rich mode.
 * Inline `style=` alone is not enough — web/Word paste is full of those.
 */
export function looksLikeDesignedEmailHtml(html: string): boolean {
  const s = html.trim();
  if (!s) return false;
  if (looksLikeFullHtmlDocument(s)) return true;
  if (/<style[\s>]/i.test(s)) return true;
  if (/<table[\s>]/i.test(s)) return true;
  return false;
}

/** Drafts/templates that must stay in HTML source so inline styles survive TipTap. */
export function looksLikeRawHtmlSource(html: string): boolean {
  return looksLikeDesignedEmailHtml(html) || /\sstyle\s*=/.test(html.trim());
}

const FRAGMENT_TYPOGRAPHY = `
  body { margin: 0; padding: 16px; background: #ffffff; color: #1a1a2e;
    font: 13.5px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    word-break: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #4f46e5; }
  pre { white-space: pre-wrap; }
  blockquote { border-left: 3px solid #d8dbe8; margin: 8px 0; padding-left: 12px; color: #5d6479; }
`;

const MINIMAL_RESET = `
  html, body { margin: 0; padding: 0; background: #ffffff; color-scheme: light; }
`;

function ensurePreviewMeta(doc: string): string {
  let out = doc.trim();
  if (!/^<!doctype/i.test(out)) {
    out = `<!doctype html>${out}`;
  }
  if (!/<head[\s>]/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head></head>`);
  }
  if (!/<meta\s+charset=/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">`);
  }
  if (!/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base target="_blank">`);
  }
  return out;
}

/**
 * Build a srcDoc string that renders like an email client:
 * - Full documents are used as-is (plus charset / base target).
 * - Designed fragments (tables, styles) get a blank white canvas — no
 *   typography CSS that would override the email's own layout.
 * - Simple rich-text fragments get a readable default font, matching how
 *   most clients render unstyled HTML.
 */
export function wrapEmailHtmlForPreview(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>`;
  }
  if (looksLikeFullHtmlDocument(trimmed)) {
    return ensurePreviewMeta(trimmed);
  }
  const css = looksLikeRawHtmlSource(trimmed) ? MINIMAL_RESET : FRAGMENT_TYPOGRAPHY;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>${css}</style></head><body>${trimmed}</body></html>`;
}

/** Append markup inside </body> when present, otherwise at the end. */
export function appendToEmailHtml(html: string, insertion: string): string {
  const close = /<\/body>/i.exec(html);
  if (close) return html.slice(0, close.index) + insertion + html.slice(close.index);
  const empty = !html.trim() || html.trim() === "<p></p>";
  if (empty) return insertion;
  return `${html}${insertion}`;
}
