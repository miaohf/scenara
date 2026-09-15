import React from 'react';

type HighlightRange = {
  start: number;
  end: number;
  kind: 'lock' | 'find' | 'find-current';
};

const MARKER = 'text-[var(--text-muted)]';
const BODY = 'text-[var(--text-secondary)]';
const STRONG = 'text-[var(--text-primary)]';
const H1 = 'text-[var(--text-primary)]';
const H2 = 'text-[var(--accent-text)]';
const H3 = 'text-[var(--text-tertiary)]';

const RANGE_CLASS: Record<HighlightRange['kind'], string> = {
  lock: 'bg-[var(--accent-bg)] rounded-[2px]',
  find: 'bg-[var(--warning-bg)] rounded-[2px]',
  'find-current': 'bg-[var(--accent-bg-hover)] rounded-[2px]',
};

const clipRanges = (
  ranges: HighlightRange[],
  start: number,
  end: number
): HighlightRange[] => {
  const clipped: HighlightRange[] = [];
  for (const range of ranges) {
    const from = Math.max(range.start, start);
    const to = Math.min(range.end, end);
    if (to > from) clipped.push({ ...range, start: from, end: to });
  }
  return clipped;
};

const wrapRanges = (
  text: string,
  globalStart: number,
  ranges: HighlightRange[],
  keyPrefix: string
): React.ReactNode => {
  if (!text) return null;
  const local = clipRanges(ranges, globalStart, globalStart + text.length)
    .map((range) => ({
      ...range,
      start: range.start - globalStart,
      end: range.end - globalStart,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  if (local.length === 0) return text;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  local.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(text.slice(cursor, range.start));
    }
    const from = Math.max(range.start, cursor);
    if (range.end > from) {
      nodes.push(
        <span key={`${keyPrefix}-r${index}`} className={RANGE_CLASS[range.kind]}>
          {text.slice(from, range.end)}
        </span>
      );
      cursor = range.end;
    }
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
};

const renderInline = (
  text: string,
  globalStart: number,
  ranges: HighlightRange[],
  keyPrefix: string
): React.ReactNode => {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      nodes.push(
        wrapRanges(
          text.slice(last, match.index),
          globalStart + last,
          ranges,
          `${keyPrefix}-t${i}`
        )
      );
    }
    const innerStart = globalStart + match.index;
    nodes.push(
      <span key={`${keyPrefix}-b${i}`}>
        {wrapRanges('**', innerStart, ranges, `${keyPrefix}-bl${i}`)}
        <span className={STRONG}>
          {wrapRanges(match[1], innerStart + 2, ranges, `${keyPrefix}-bi${i}`)}
        </span>
        {wrapRanges('**', innerStart + 2 + match[1].length, ranges, `${keyPrefix}-br${i}`)}
      </span>
    );
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < text.length) {
    nodes.push(
      wrapRanges(text.slice(last), globalStart + last, ranges, `${keyPrefix}-t-end`)
    );
  }
  return nodes;
};

const renderMarkdownInline = (text: string, keyPrefix: string): React.ReactNode => {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-[var(--text-primary)]">
        {match[1]}
      </strong>,
    );
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length > 0 ? nodes : text;
};

const headingClass = (level: number): string => {
  if (level === 1) return H1;
  if (level === 2) return H2;
  return H3;
};

export const renderHighlightedScript = (
  script: string,
  ranges: HighlightRange[] = []
): React.ReactNode => {
  if (!script) return '\u00a0';

  const lines = script.split('\n');
  const nodes: React.ReactNode[] = [];
  let offset = 0;

  lines.forEach((line, index) => {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    let content: React.ReactNode;
    if (heading) {
      const hashes = heading[1];
      const title = heading[2];
      content = (
        <span className={headingClass(hashes.length)} data-script-offset={offset}>
          <span className={MARKER}>{wrapRanges(`${hashes} `, offset, ranges, `h${index}-m`)}</span>
          {renderInline(title, offset + hashes.length + 1, ranges, `h${index}`)}
        </span>
      );
    } else {
      content = (
        <span className={BODY} data-script-offset={offset}>
          {renderInline(line, offset, ranges, `l${index}`)}
        </span>
      );
    }

    nodes.push(
      <React.Fragment key={`line-${index}`}>
        {content}
        {index < lines.length - 1 ? '\n' : null}
      </React.Fragment>
    );
    offset += line.length + 1;
  });

  return nodes;
};

/** Render the screenplay as readable Markdown without exposing the Markdown syntax. */
export const renderMarkdownPreview = (script: string): React.ReactNode => {
  if (!script) return '\u00a0';

  let offset = 0;
  return script.split('\n').map((line, index, lines) => {
    const lineOffset = offset;
    offset += line.length + 1;
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const key = `preview-line-${index}`;
    const lineBreak = index < lines.length - 1 ? <div key={`${key}-break`} className="h-1" /> : null;

    if (heading) {
      const HeadingTag = heading[1].length === 1 ? 'h1' : heading[1].length === 2 ? 'h2' : 'h3';
      const headingClass = heading[1].length === 1
        ? 'mt-3 mb-2 text-xl font-bold text-[var(--text-primary)]'
        : heading[1].length === 2
          ? 'mt-3 mb-1.5 text-base font-semibold text-[var(--accent-text)]'
          : 'mt-2 mb-1 text-sm font-medium text-[var(--text-tertiary)]';
      return (
        <React.Fragment key={key}>
          <HeadingTag data-script-offset={lineOffset} className={headingClass}>
            {renderMarkdownInline(heading[2], key)}
          </HeadingTag>
          {lineBreak}
        </React.Fragment>
      );
    }

    return (
      <React.Fragment key={key}>
        {line.trim() ? (
          <p data-script-offset={lineOffset} className="m-0 min-h-[1.45em] text-[13px] leading-[1.45] text-[var(--text-secondary)]">
            {renderMarkdownInline(line, key)}
          </p>
        ) : (
          <div className="h-2" aria-hidden="true" />
        )}
        {lineBreak}
      </React.Fragment>
    );
  });
};
