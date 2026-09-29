export interface InboxNote {
  readonly title: string;
  readonly body: string;
  readonly provenance: string | null;
  readonly createdAt: string;
}

export type CaptureResult =
  | { ok: true; filename: string; content: string }
  | { ok: false; reason: CaptureError };

export type CaptureError =
  | 'empty_title'
  | 'title_too_long'
  | 'path_traversal'
  | 'invalid_timestamp';

const ISO_8601_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

function parseTimestamp(timestamp: string): { datePart: string; timePart: string } | null {
  if (typeof timestamp !== 'string' || !timestamp.trim()) {
    return null;
  }
  const match = ISO_8601_PATTERN.exec(timestamp.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return null;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    return null;
  }

  if (match[4] !== undefined) {
    const hours = Number(match[4]);
    const minutes = Number(match[5]);
    const seconds = match[6] !== undefined ? Number(match[6]) : 0;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
      return null;
    }
  }

  const d = new Date(timestamp.trim());
  if (isNaN(d.getTime())) {
    return null;
  }

  const iso = d.toISOString();
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19);
  return { datePart, timePart };
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function generateFilename(title: string, timestamp: string): string {
  const parsed = parseTimestamp(timestamp);
  if (!parsed) {
    return '';
  }
  const slug = toSlug(title);
  return `${parsed.datePart}-${parsed.timePart}-${slug}.md`;
}

export function validateCapture(title: string, inboxDir: string): CaptureError | null {
  if (title.trim().length === 0) {
    return 'empty_title';
  }
  if (title.length > 200) {
    return 'title_too_long';
  }
  if (inboxDir.includes('..') || inboxDir.startsWith('/') || inboxDir.startsWith('~')) {
    return 'path_traversal';
  }
  return null;
}

const YAML_SPECIAL_CHARS = /[:#[\]{}&*!|>'"`%@?,]/;

function formatYamlTitle(title: string): string {
  if (
    YAML_SPECIAL_CHARS.test(title) ||
    title.startsWith('-') ||
    title.startsWith('?') ||
    title.startsWith(' ') ||
    title.endsWith(' ')
  ) {
    return `"${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return title;
}

export function formatNote(note: InboxNote): string {
  const formattedTitle = formatYamlTitle(note.title);
  const provenance = note.provenance ?? 'direct';
  const frontmatter = `---
title: ${formattedTitle}
created: ${note.createdAt}
provenance: ${provenance}
---`;

  if (!note.body || note.body.trim().length === 0) {
    return `${frontmatter}\n\n`;
  }

  const trimmedBody = note.body.trim();
  return `${frontmatter}\n\n${trimmedBody}\n`;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function unquoteYaml(val: string): string {
  val = val.trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    const inner = val.slice(1, -1);
    if (val.startsWith('"')) {
      return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return val;
}

export function parseNote(content: string): InboxNote | null {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) {
    return null;
  }

  const fmLines = match[1].split('\n');
  const meta: Record<string, string> = {};
  for (const line of fmLines) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawVal = line.slice(separator + 1).trim();
    meta[key] = unquoteYaml(rawVal);
  }

  if (!meta.title || meta.title.trim().length === 0) {
    return null;
  }

  const rawProvenance = meta.provenance;
  const provenance =
    !rawProvenance || rawProvenance === 'direct' || rawProvenance === 'null'
      ? null
      : rawProvenance;

  const createdAt = meta.created ?? '';
  const body = match[2].trim();

  return {
    title: meta.title,
    body,
    provenance,
    createdAt,
  };
}

export function createCapture(
  title: string,
  body: string,
  provenance: string | null,
  timestamp: string,
  inboxDir: string
): CaptureResult {
  const validationError = validateCapture(title, inboxDir);
  if (validationError !== null) {
    return { ok: false, reason: validationError };
  }

  const filename = generateFilename(title, timestamp);
  if (filename === '') {
    return { ok: false, reason: 'invalid_timestamp' };
  }

  const note: InboxNote = {
    title,
    body,
    provenance,
    createdAt: timestamp,
  };

  const content = formatNote(note);
  return { ok: true, filename, content };
}
