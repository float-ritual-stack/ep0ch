interface TextRange {
  start: number;
  end: number;
}

interface ListContainer {
  indent: number;
  contentIndent: number;
  contentOffset: number;
}

function indentationColumns(value: string): number {
  let columns = 0;
  for (const character of value) {
    columns = character === "\t" ? columns + (4 - columns % 4) : columns + 1;
  }
  return columns;
}

function listMarker(line: string): ListContainer | null {
  const match = /^([ \t]*)(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(line);
  if (!match) return null;
  const indent = indentationColumns(match[1]);
  return {
    indent,
    contentIndent: indent + indentationColumns(match[0].slice(match[1].length)),
    contentOffset: match[0].length,
  };
}

function fenceMarker(
  line: string,
  contentIndent: number,
  closing = false,
): string | null {
  const match = closing
    ? /^([ \t]*)(`{3,}|~{3,})[ \t]*\r?$/.exec(line)
    : /^([ \t]*)(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  const relativeIndent = indentationColumns(match[1]) - contentIndent;
  return relativeIndent >= 0 && relativeIndent <= 3 ? match[2] : null;
}

export function protectedCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const listContainers: ListContainer[] = [];
  let activeFence: {
    marker: string;
    length: number;
    contentIndent: number;
  } | null = null;
  let activeIndentedCode = false;
  let canStartIndentedCode = true;
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    if (activeFence) {
      ranges.push({ start: lineStart, end: lineEnd });
      const closing = fenceMarker(line, activeFence.contentIndent, true);
      if (
        closing &&
        closing[0] === activeFence.marker &&
        closing.length >= activeFence.length
      ) {
        activeFence = null;
        canStartIndentedCode = true;
      }
    } else if (/^[ \t]*\r?$/.test(line)) {
      canStartIndentedCode = true;
    } else {
      const indent = indentationColumns(/^[ \t]*/.exec(line)?.[0] ?? "");
      while (
        listContainers.length > 0 &&
        indent < listContainers[listContainers.length - 1]!.contentIndent
      ) {
        listContainers.pop();
      }

      const marker = listMarker(line);
      const parent = listContainers[listContainers.length - 1];
      const startsListItem = marker !== null &&
        (parent ? marker.indent - parent.contentIndent <= 3 : marker.indent <= 3);
      let fenceContentIndent = parent?.contentIndent ?? 0;
      let openingLine = line;
      if (startsListItem) {
        listContainers.push(marker);
        activeIndentedCode = false;
        fenceContentIndent = marker.contentIndent;
        openingLine = line.slice(marker.contentOffset);
      }

      const opening = fenceMarker(
        openingLine,
        startsListItem ? 0 : fenceContentIndent,
      );
      if (opening) {
        ranges.push({ start: lineStart, end: lineEnd });
        activeFence = {
          marker: opening[0],
          length: opening.length,
          contentIndent: fenceContentIndent,
        };
        activeIndentedCode = false;
      } else if (!startsListItem) {
        const relativeIndent = indent - fenceContentIndent;
        const indented = relativeIndent >= 4;
        if (indented && (activeIndentedCode || canStartIndentedCode)) {
          ranges.push({ start: lineStart, end: lineEnd });
          activeIndentedCode = true;
        } else if (!indented) {
          activeIndentedCode = false;
        }
      }
      canStartIndentedCode = false;
    }
    lineStart = lineEnd + 1;
  }
  for (const pattern of [/(`+)[^\n]*?\1/g]) {
    for (const match of text.matchAll(pattern)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}
