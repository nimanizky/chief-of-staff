export type WishlistBoardKey = string;

export type WishlistCommand =
  | {
      kind: "show";
      board: WishlistBoardKey;
      section?: string;
    }
  | {
      kind: "add";
      board: WishlistBoardKey;
      section: string;
      item: string;
    }
  | {
      kind: "done" | "undone";
      board: WishlistBoardKey;
      query: string;
    }
  | {
      kind: "import";
      board: WishlistBoardKey;
      content: string;
    };

export type WishlistEditResult =
  | {
      status: "shown";
      message: string;
    }
  | {
      status: "changed";
      content: string;
      message: string;
      commitMessage: string;
    }
  | {
      status: "not_found" | "ambiguous" | "invalid";
      message: string;
    };

type Heading = {
  level: 1 | 2 | 3;
  title: string;
  index: number;
};

const DONE_PATTERN = /^(?:DN|DONE,?)\s*[-,]?\s*/i;
const BOARD_KEY_PATTERN = "[a-z0-9][a-z0-9_-]*";

export function parseWishlistCommand(rawText: string): WishlistCommand | null {
  for (const text of commandTextCandidates(rawText)) {
    const command = parseWishlistCommandText(text);
    if (command) return command;
  }

  return null;
}

function parseWishlistCommandText(text: string): WishlistCommand | null {
  const normalized = normalizeCommandText(text);
  const importBoard = detectImportBoard(text);
  if (importBoard) return { kind: "import", board: importBoard, content: text };

  const showMatch = normalized.match(new RegExp(`^show\\s+(${BOARD_KEY_PATTERN})(?:[-\\s]*(?:wishlist|wish))?(?:\\s+(.+))?$`, "i"));
  if (showMatch) {
    const board = normalizeBoard(showMatch[1]);
    if (!board) return null;
    const section = normalizeSectionInput(showMatch[2] ?? "");
    return section ? { kind: "show", board, section } : { kind: "show", board };
  }

  const addMatch = text.match(new RegExp(`^add(?:\\s+in)?\\s+(${BOARD_KEY_PATTERN})(?:[-\\s]*(?:wishlist|wish))?\\s+([^:]+):\\s*(.+)$`, "i"));
  if (addMatch) {
    const board = normalizeBoard(addMatch[1]);
    if (!board) return null;
    const target = normalizeAddTarget(board, addMatch[2], addMatch[3]);
    const section = target.section;
    const item = target.item;
    if (!section || !item) return null;
    return { kind: "add", board, section, item };
  }

  const doneMatch = text.match(new RegExp(`^(done|undone)\\s+(${BOARD_KEY_PATTERN})(?:[-\\s]*(?:wishlist|wish))?\\s+(.+)$`, "i"));
  if (doneMatch) {
    const board = normalizeBoard(doneMatch[2]);
    const query = normalizeItem(doneMatch[3]);
    if (!board || !query) return null;
    return { kind: doneMatch[1].toLowerCase() as "done" | "undone", board, query };
  }

  return null;
}

export function applyWishlistCommand(content: string, command: WishlistCommand): WishlistEditResult {
  switch (command.kind) {
    case "show":
      return showWishlist(content, command.board, command.section);
    case "add":
      return addWishlistItem(content, command.board, command.section, command.item);
    case "done":
    case "undone":
      return markWishlistItem(content, command.query, command.kind === "done", command.board);
    case "import":
      return importWishlistBoard(content, command.board, command.content);
  }
}

export function normalizeDoneLine(line: string): string {
  const item = normalizeItem(line.replace(DONE_PATTERN, ""));
  return `DN ${item}`;
}

function showWishlist(content: string, board: WishlistBoardKey, section?: string): WishlistEditResult {
  const boardRange = findBoardRange(content, board);
  if (!boardRange) {
    return { status: "not_found", message: `${boardTitle(board)} is empty.` };
  }

  if (!section) {
    return {
      status: "shown",
      message: content.slice(boardRange.start, boardRange.end).trim()
    };
  }

  const sectionRange = findSectionRange(content, boardRange, section);
  if (!sectionRange) {
    return { status: "not_found", message: `${boardLabel(content, board)} / ${section.toUpperCase()} was not found.` };
  }

  return {
    status: "shown",
    message: content.slice(sectionRange.start, sectionRange.end).trim()
  };
}

function addWishlistItem(content: string, board: WishlistBoardKey, section: string, item: string): WishlistEditResult {
  const normalizedItem = normalizeItem(item);
  const ensured = ensureBoardAndSection(content, board, section);
  const lines = splitLines(ensured.content);
  const sectionEndLine = findSectionEndLine(lines, ensured.sectionHeadingLine);

  if (sectionContainsItem(lines, ensured.sectionHeadingLine, sectionEndLine, normalizedItem)) {
    return { status: "invalid", message: `Already exists in ${boardLabel(ensured.content, board)} / ${section.toUpperCase()}: ${normalizedItem}` };
  }

  const insertAt = trimTrailingBlankLinesBefore(lines, sectionEndLine);
  lines.splice(insertAt, 0, normalizedItem);

  return {
    status: "changed",
    content: normalizeDocument(lines.join("\n")),
    message: `Added to ${boardLabel(ensured.content, board)} / ${section.toUpperCase()}: ${normalizedItem}`,
    commitMessage: `wishlist: add ${board} ${section.toLowerCase()} item`
  };
}

function markWishlistItem(
  content: string,
  query: string,
  done: boolean,
  board?: WishlistBoardKey
): WishlistEditResult {
  const lines = splitLines(content);
  const matches = findItemMatches(lines, query, board);

  if (matches.length === 0) {
    return { status: "not_found", message: `Could not find wishlist item matching: ${query}` };
  }

  if (matches.length > 1) {
    const candidates = matches
      .slice(0, 8)
      .map((match, index) => `${index + 1}. ${match.board.toUpperCase()} / ${match.section}: ${stripDone(match.line)}`)
      .join("\n");
    return {
      status: "ambiguous",
      message: `Multiple wishlist items matched "${query}". Be more specific:\n${candidates}`
    };
  }

  const match = matches[0];
  const item = stripDone(match.line);
  const nextLine = done ? `DN ${item}` : item;
  if (lines[match.lineIndex] === nextLine) {
    return {
      status: "invalid",
      message: `${item} is already ${done ? "done" : "pending"}.`
    };
  }

  lines[match.lineIndex] = nextLine;
  return {
    status: "changed",
    content: normalizeDocument(lines.join("\n")),
    message: `${done ? "Marked done" : "Marked pending"}: ${item}`,
    commitMessage: `wishlist: mark ${match.board} item ${done ? "done" : "pending"}`
  };
}

function importWishlistBoard(content: string, board: WishlistBoardKey, importText: string): WishlistEditResult {
  const parsed = parseBoardImport(board, importText);
  if (parsed.sections.length === 0) {
    return { status: "invalid", message: `No sections found in ${boardTitle(board)} import.` };
  }

  let next = ensureBoard(content, board);
  for (const section of parsed.sections) {
    next = ensureBoardAndSection(next, board, section.title).content;
    const lines = splitLines(next);
    const boardRange = findBoardRange(next, board);
    if (!boardRange) continue;
    const sectionRange = findSectionRange(next, boardRange, section.title);
    if (!sectionRange) continue;
    const headings = findHeadings(next);
    const sectionHeading = headings.find((heading) => heading.index === sectionRange.headingIndex);
    if (!sectionHeading) continue;
    const sectionHeadingLine = lineIndexAt(next, sectionHeading.index);
    const sectionEndLine = findSectionEndLine(lines, sectionHeadingLine);
    const existing = new Set(sectionItems(lines, sectionHeadingLine, sectionEndLine).map(canonicalItem));
    const toAdd: string[] = [];
    for (const item of section.items) {
      const canonical = canonicalItem(item);
      if (existing.has(canonical)) continue;
      existing.add(canonical);
      toAdd.push(item);
    }
    if (toAdd.length === 0) {
      next = lines.join("\n");
      continue;
    }
    const insertAt = trimTrailingBlankLinesBefore(lines, sectionEndLine);
    lines.splice(insertAt, 0, ...toAdd);
    next = lines.join("\n");
  }

  const normalized = normalizeDocument(next);
  if (normalized === normalizeDocument(content)) {
    return { status: "invalid", message: `${boardLabel(normalized, board)} import had no new items.` };
  }

  return {
    status: "changed",
    content: normalized,
    message: `Imported ${boardLabel(normalized, board)}.`,
    commitMessage: "wishlist: import backlog wishlist"
  };
}

function parseBoardImport(board: WishlistBoardKey, importText: string): { sections: Array<{ title: string; items: string[] }> } {
  const lines = splitLines(importText)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sections: Array<{ title: string; items: string[] }> = [];
  let current: { title: string; items: string[] } | null = null;

  for (const line of lines) {
    const cleaned = cleanImportLine(line);
    if (!cleaned || isBoardTitle(cleaned, board)) continue;
    if (looksLikeSection(cleaned)) {
      current = { title: normalizeSectionInput(cleaned), items: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    current.items.push(normalizeImportedItem(cleaned));
  }

  return { sections: sections.filter((section) => section.items.length > 0) };
}

function ensureBoardAndSection(
  content: string,
  board: WishlistBoardKey,
  section: string
): { content: string; sectionHeadingLine: number } {
  const withBoard = ensureBoard(content, board);
  const boardRange = findBoardRange(withBoard, board);
  if (!boardRange) throw new Error(`Failed to create ${boardTitle(board)}.`);
  const sectionRange = findSectionRange(withBoard, boardRange, section);
  if (sectionRange) {
    return {
      content: withBoard,
      sectionHeadingLine: lineIndexAt(withBoard, sectionRange.headingIndex)
    };
  }

  const lines = splitLines(withBoard);
  const insertAt = lineIndexAt(withBoard, boardRange.end);
  const prefix = insertAt > 0 && lines[insertAt - 1]?.trim() !== "" ? [""] : [];
  lines.splice(insertAt, 0, ...prefix, sectionHeading(board, section), "");
  const nextContent = normalizeDocument(lines.join("\n"));
  const nextBoardRange = findBoardRange(nextContent, board);
  const nextSectionRange = nextBoardRange ? findSectionRange(nextContent, nextBoardRange, section) : null;
  if (!nextSectionRange) throw new Error(`Failed to create ${section}.`);
  return {
    content: nextContent,
    sectionHeadingLine: lineIndexAt(nextContent, nextSectionRange.headingIndex)
  };
}

function ensureBoard(content: string, board: WishlistBoardKey): string {
  if (findBoardRange(content, board)) return content;
  const prefix = content.trim().length > 0 ? `${content.trimEnd()}\n\n` : "";
  return `${prefix}# ${boardTitle(board)}\n`;
}

function findBoardRange(content: string, board: WishlistBoardKey): { start: number; end: number; headingIndex: number } | null {
  const headings = findHeadings(content);
  const headingIndex = headings.findIndex((heading) => heading.level === 1 && boardFromTitle(heading.title) === board);
  if (headingIndex < 0) return null;
  const heading = headings[headingIndex];
  const nextBoard = headings.slice(headingIndex + 1).find((candidate) => candidate.level === 1);
  return {
    start: heading.index,
    end: nextBoard?.index ?? content.length,
    headingIndex: heading.index
  };
}

function findSectionRange(
  content: string,
  boardRange: { start: number; end: number },
  section: string
): { start: number; end: number; headingIndex: number } | null {
  const target = normalizeHeading(section);
  const headings = findHeadings(content).filter((heading) => heading.index > boardRange.start && heading.index < boardRange.end);
  const headingIndex = headings.findIndex(
    (heading) => (heading.level === 2 || heading.level === 3) && normalizeHeading(heading.title) === target
  );
  if (headingIndex < 0) return null;
  const heading = headings[headingIndex];
  const next = headings.slice(headingIndex + 1).find((candidate) => candidate.level <= heading.level);
  return {
    start: heading.index,
    end: next?.index ?? boardRange.end,
    headingIndex: heading.index
  };
}

function findHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  const pattern = /^(#{1,3})\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    headings.push({
      level: match[1].length as 1 | 2 | 3,
      title: match[2].trim(),
      index: match.index
    });
  }
  return headings;
}

function findItemMatches(lines: string[], query: string, boardFilter?: WishlistBoardKey) {
  const normalizedQuery = canonicalItem(query);
  const matches: Array<{ lineIndex: number; line: string; board: WishlistBoardKey; section: string }> = [];
  let currentBoard: WishlistBoardKey | null = null;
  let currentSection = "";

  lines.forEach((line, lineIndex) => {
    const headingMatch = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (level === 1) currentBoard = boardFromTitle(title);
      if ((level === 2 || level === 3) && currentBoard) currentSection = normalizeSectionInput(title);
      return;
    }

    const item = normalizeItem(line);
    if (!item || !currentBoard || (boardFilter && currentBoard !== boardFilter)) return;
    const canonical = canonicalItem(item);
    if (canonical === normalizedQuery || canonical.includes(normalizedQuery)) {
      matches.push({ lineIndex, line: item, board: currentBoard, section: currentSection });
    }
  });

  return matches;
}

function findSectionEndLine(lines: string[], sectionHeadingLine: number): number {
  const currentHeading = lines[sectionHeadingLine]?.match(/^(#{2,3})\s+/);
  const currentLevel = currentHeading?.[1].length ?? 2;
  for (let index = sectionHeadingLine + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,3})\s+/);
    if (heading && heading[1].length <= currentLevel) return index;
  }
  return lines.length;
}

function sectionContainsItem(lines: string[], startLine: number, endLine: number, item: string): boolean {
  const target = canonicalItem(item);
  return sectionItems(lines, startLine, endLine).some((candidate) => canonicalItem(candidate) === target);
}

function sectionItems(lines: string[], startLine: number, endLine: number): string[] {
  return lines
    .slice(startLine + 1, endLine)
    .map(normalizeItem)
    .filter(Boolean);
}

function trimTrailingBlankLinesBefore(lines: string[], endLine: number): number {
  let insertAt = endLine;
  while (insertAt > 0 && lines[insertAt - 1]?.trim() === "") insertAt -= 1;
  return insertAt;
}

function lineIndexAt(content: string, charIndex: number): number {
  return content.slice(0, charIndex).split("\n").length - 1;
}

function splitLines(content: string): string[] {
  if (!content) return [];
  return content.replace(/\r\n/g, "\n").split("\n");
}

function normalizeDocument(content: string): string {
  return `${content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()}\n`;
}

function normalizeCommandText(text: string): string {
  return text.replace(/[‐‑‒–—]/g, "-").replace(/\s+/g, " ").trim();
}

function normalizeAddTarget(
  board: WishlistBoardKey,
  rawSection: string,
  rawItem: string
): { section: string; item: string } {
  const section = normalizeSectionInput(rawSection);
  const item = normalizeItem(rawItem);
  if (board !== "jkt") return { section, item };

  const monthWeek = section.match(/^(JAN|FEB|MARCH|APR|MAY|JUNE|JULY|AUG|SEP|OCT|NOV|DEC)\s+(W\d+)$/i);
  if (!monthWeek) return { section, item };

  return {
    section: monthWeek[1].toUpperCase(),
    item: `${monthWeek[2].toUpperCase()} - ${item}`
  };
}

function normalizeBoard(value: string): WishlistBoardKey | null {
  const normalized = normalizeBoardKey(value).replace(/-(?:wishlist|wish)$/i, "");
  return normalized && new RegExp(`^${BOARD_KEY_PATTERN}$`, "i").test(normalized) ? normalized : null;
}

function boardFromTitle(title: string): WishlistBoardKey | null {
  const normalized = normalizeHeading(title);
  if (normalized === "WISHLIST" || normalized === "BACKLOG") return null;
  return normalizeBoardKey(normalized.replace(/\s+(?:WISHLIST|BACKLOG|LIST)$/i, ""));
}

function boardTitle(board: WishlistBoardKey): string {
  return `${displayBoardKey(board)} WISHLIST`;
}

function boardLabel(content: string, board: WishlistBoardKey): string {
  const range = findBoardRange(content, board);
  if (!range) return boardTitle(board);
  const heading = findHeadings(content).find((candidate) => candidate.index === range.headingIndex);
  return heading?.title ?? boardTitle(board);
}

function displayBoardKey(board: WishlistBoardKey): string {
  return board.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizeBoardKey(value: string): string {
  return value
    .replace(/^!+\s*/, "")
    .replace(/\s*!+$/, "")
    .replace(/^#+\s*/, "")
    .replace(/[:：]\s*$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, "-")
    .trim()
    .toLowerCase();
}

function normalizeSectionInput(value: string): string {
  return value.replace(/[:：]\s*$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^!+\s*/, "")
    .replace(/\s*!+$/, "")
    .replace(/[:：]\s*$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeItem(value: string): string {
  return value.replace(/^[\u200b-\u200f\u202a-\u202e\u2060-\u206f]+/, "").replace(/\s+/g, " ").trim();
}

function normalizeImportedItem(value: string): string {
  const item = normalizeItem(value);
  return DONE_PATTERN.test(item) ? normalizeDoneLine(item) : item;
}

function cleanImportLine(value: string): string {
  return normalizeItem(value.replace(/^#+\s*/, "").replace(/^!+\s*/, "").replace(/\s*!+$/, ""));
}

function isBoardTitle(value: string, board: WishlistBoardKey): boolean {
  return boardFromTitle(value) === board || normalizeHeading(value) === "WISHLIST";
}

function looksLikeSection(value: string): boolean {
  if (!value) return false;
  if (DONE_PATTERN.test(value)) return false;
  if (/[,.]/.test(value)) return false;
  if (/^(?:W\d+\s+|W\d+\s*-|https?:|www\.)/i.test(value)) return false;
  const normalized = normalizeHeading(value);
  if (normalized.length > 40) return false;
  return value === value.toUpperCase() || /^(?:20\d{2}\s+BACKLOG|JAN|FEB|MARCH|APR|MAY|JUNE|JULY|AUG|SEP|OCT|NOV|DEC|JAN IG)$/i.test(value);
}

function sectionHeading(board: WishlistBoardKey, section: string): string {
  return board === "jkt" && /^(?:JAN|FEB|MARCH|APR|MAY|JUNE|JULY|AUG|SEP|OCT|NOV|DEC|JAN IG)$/i.test(section)
    ? `### ${section.toUpperCase()}`
    : `## ${section.toUpperCase()}`;
}

function canonicalItem(value: string): string {
  return stripDone(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDone(value: string): string {
  return normalizeItem(value).replace(DONE_PATTERN, "").trim();
}

function stripBotMention(value: string): string {
  return value
    .replace(/^\s*@(?:~?imn[-\s]?claw|claw|openclaw|6287887848449|[0-9]+)(?:\s+|$)/i, "")
    .trim();
}

function stripLeadingMention(value: string): string {
  return value.replace(/^\s*@\S+(?:\s+|$)/u, "").trim();
}

function commandTextCandidates(rawText: string): string[] {
  return uniqueNonEmpty([stripBotMention(rawText), stripLeadingMention(rawText), rawText.trim()]);
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function detectImportBoard(text: string): WishlistBoardKey | null {
  const firstMeaningfulLine = splitLines(text).map(cleanImportLine).find(Boolean);
  if (!firstMeaningfulLine) return null;
  if (/^(?:show|add|done|undone)\b/i.test(firstMeaningfulLine)) return null;
  const normalized = normalizeHeading(firstMeaningfulLine);
  if (!/\s(?:WISHLIST|BACKLOG|LIST)$/i.test(normalized)) return null;
  return boardFromTitle(firstMeaningfulLine);
}
