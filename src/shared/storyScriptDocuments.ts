export type StoryScriptDocumentFormat = "markdown" | "csv";

export interface StoryScriptDocumentBeat {
  description: string;
  durationSec: number;
}

export interface StoryScriptParseResult {
  beats: StoryScriptDocumentBeat[];
  errors: string[];
}

export const STORY_SCRIPT_MARKDOWN_TEMPLATE = `# StoryboardAI 分镜脚本

## 分镜 01
时长（秒）: 5

清晨，宽阔的城市街道刚刚亮起路灯，镜头缓慢向前推进。

## 分镜 02
时长（秒）: 4.5

主人公推开工作室的门，阳光从身后照进室内。
`;

export const STORY_SCRIPT_CSV_TEMPLATE = `序号,分镜描述,时长（秒）
1,"清晨，宽阔的城市街道刚刚亮起路灯，镜头缓慢向前推进。",5
2,"主人公推开工作室的门，阳光从身后照进室内。",4.5
`;

const DESCRIPTION_HEADERS = new Set([
  "分镜描述",
  "镜头描述",
  "描述",
  "内容",
  "description",
  "prompt",
  "text"
]);

const DURATION_HEADERS = new Set([
  "时长秒",
  "时长",
  "秒数",
  "duration",
  "durationsec",
  "seconds"
]);

const MARKDOWN_DURATION_LINE = /^\s*(?:[-*+]\s*)?(?:\*{1,2})?(?:时长(?:[（(]\s*秒\s*[）)])?|duration(?:\s*[（(]\s*(?:seconds?|sec)\s*[）)]|[_\s-]*sec)?|seconds?)(?:\*{1,2})?\s*[:：]\s*(.+?)\s*$/i;
const MARKDOWN_DESCRIPTION_LINE = /^\s*(?:[-*+]\s*)?(?:\*{1,2})?(?:分镜描述|镜头描述|描述|description|prompt|text)(?:\*{1,2})?\s*[:：]\s*(.*)$/i;

export const getStoryScriptTemplate = (
  format: StoryScriptDocumentFormat
): string =>
  format === "markdown"
    ? STORY_SCRIPT_MARKDOWN_TEMPLATE
    : STORY_SCRIPT_CSV_TEMPLATE;

export const getStoryScriptTemplateFileName = (
  format: StoryScriptDocumentFormat
): string =>
  format === "markdown"
    ? "StoryboardAI-分镜脚本模板.md"
    : "StoryboardAI-分镜脚本模板.csv";

export const resolveStoryScriptDocumentFormat = (
  fileName: string
): StoryScriptDocumentFormat | undefined => {
  const normalizedName = fileName.trim().toLowerCase();
  if (normalizedName.endsWith(".md") || normalizedName.endsWith(".markdown")) {
    return "markdown";
  }

  if (normalizedName.endsWith(".csv")) {
    return "csv";
  }

  return undefined;
};

export const parseStoryScriptDocument = (
  format: StoryScriptDocumentFormat,
  content: string
): StoryScriptParseResult =>
  format === "markdown"
    ? parseMarkdownStoryScript(content)
    : parseCsvStoryScript(content);

const parseMarkdownStoryScript = (content: string): StoryScriptParseResult => {
  const lines = stripByteOrderMark(content).replace(/\r\n?/g, "\n").split("\n");
  const sections: Array<{ lines: string[]; lineNumber: number }> = [];
  let currentSection:
    | { lines: string[]; lineNumber: number }
    | undefined;

  lines.forEach((line, index) => {
    const headingMatch = line.match(/^\s*##(?!#)\s+(.+?)\s*$/);
    if (headingMatch) {
      currentSection = {
        lines: [],
        lineNumber: index + 1
      };
      sections.push(currentSection);
      return;
    }

    currentSection?.lines.push(line);
  });

  if (sections.length === 0) {
    return {
      beats: [],
      errors: ["Markdown 中没有找到以“##”开头的分镜标题"]
    };
  }

  const beats: StoryScriptDocumentBeat[] = [];
  const errors: string[] = [];

  sections.forEach((section, index) => {
    let durationSec: number | undefined;
    let hasDurationLine = false;
    const descriptionLines: string[] = [];

    section.lines.forEach((line) => {
      const durationMatch = line.match(MARKDOWN_DURATION_LINE);
      if (durationMatch) {
        if (hasDurationLine) {
          errors.push(`分镜 ${index + 1}（第 ${section.lineNumber} 行）包含多个时长`);
          return;
        }

        hasDurationLine = true;
        durationSec = parseDuration(
          durationMatch[1],
          `分镜 ${index + 1}（第 ${section.lineNumber} 行）`,
          errors
        );
        return;
      }

      const descriptionMatch = line.match(MARKDOWN_DESCRIPTION_LINE);
      descriptionLines.push(descriptionMatch ? descriptionMatch[1] : line);
    });

    const description = trimBlankLines(descriptionLines).join("\n").trim();
    if (!description) {
      errors.push(`分镜 ${index + 1}（第 ${section.lineNumber} 行）缺少分镜描述`);
    }
    if (!hasDurationLine) {
      errors.push(`分镜 ${index + 1}（第 ${section.lineNumber} 行）缺少时长`);
    }

    if (description && durationSec !== undefined) {
      beats.push({ description, durationSec });
    }
  });

  return errors.length > 0 ? { beats: [], errors } : { beats, errors: [] };
};

const parseCsvStoryScript = (content: string): StoryScriptParseResult => {
  const parsedRows = parseCsvRows(stripByteOrderMark(content));
  if (parsedRows.error) {
    return { beats: [], errors: [parsedRows.error] };
  }

  const rows = parsedRows.rows.filter((row) =>
    row.cells.some((cell) => cell.trim().length > 0)
  );
  const headerRow = rows[0];
  if (!headerRow) {
    return { beats: [], errors: ["CSV 文件为空"] };
  }

  const normalizedHeaders = headerRow.cells.map(normalizeCsvHeader);
  const descriptionIndex = normalizedHeaders.findIndex((header) =>
    DESCRIPTION_HEADERS.has(header)
  );
  const durationIndex = normalizedHeaders.findIndex((header) =>
    DURATION_HEADERS.has(header)
  );
  const errors: string[] = [];

  if (descriptionIndex < 0) {
    errors.push("CSV 表头缺少“分镜描述”列");
  }
  if (durationIndex < 0) {
    errors.push("CSV 表头缺少“时长（秒）”列");
  }
  if (errors.length > 0) {
    return { beats: [], errors };
  }

  const beats: StoryScriptDocumentBeat[] = [];
  rows.slice(1).forEach((row) => {
    const description = (row.cells[descriptionIndex] ?? "").trim();
    const durationValue = (row.cells[durationIndex] ?? "").trim();
    if (!description) {
      errors.push(`CSV 第 ${row.lineNumber} 行缺少分镜描述`);
    }
    const durationSec = durationValue
      ? parseDuration(durationValue, `CSV 第 ${row.lineNumber} 行`, errors)
      : undefined;
    if (!durationValue) {
      errors.push(`CSV 第 ${row.lineNumber} 行缺少时长`);
    }

    if (description && durationSec !== undefined) {
      beats.push({ description, durationSec });
    }
  });

  if (rows.length === 1) {
    errors.push("CSV 中没有可导入的分镜数据");
  }

  return errors.length > 0 ? { beats: [], errors } : { beats, errors: [] };
};

interface CsvRow {
  cells: string[];
  lineNumber: number;
}

const parseCsvRows = (
  content: string
): { rows: CsvRow[]; error?: string } => {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let insideQuotes = false;
  let lineNumber = 1;
  let rowLineNumber = 1;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (insideQuotes) {
      if (character === '"' && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        insideQuotes = false;
      } else {
        cell += character;
        if (character === "\n") {
          lineNumber += 1;
        }
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      insideQuotes = true;
    } else if (character === ",") {
      cells.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      cells.push(cell);
      rows.push({ cells, lineNumber: rowLineNumber });
      cells = [];
      cell = "";
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      lineNumber += 1;
      rowLineNumber = lineNumber;
    } else {
      cell += character;
    }
  }

  if (insideQuotes) {
    return { rows: [], error: `CSV 第 ${rowLineNumber} 行存在未闭合的引号` };
  }

  if (cell.length > 0 || cells.length > 0) {
    cells.push(cell);
    rows.push({ cells, lineNumber: rowLineNumber });
  }

  return { rows };
};

const parseDuration = (
  rawValue: string,
  location: string,
  errors: string[]
): number | undefined => {
  const normalizedValue = rawValue.trim().replace(/(?:秒|seconds?|secs?|s)\s*$/i, "");
  const durationSec = Number(normalizedValue);
  if (!Number.isFinite(durationSec) || durationSec < 0.1) {
    errors.push(`${location}的时长必须是不小于 0.1 的数字`);
    return undefined;
  }

  return Math.round(durationSec * 10) / 10;
};

const normalizeCsvHeader = (header: string): string =>
  stripByteOrderMark(header)
    .trim()
    .toLowerCase()
    .replace(/[\s_\-（()）:：]/g, "");

const trimBlankLines = (lines: string[]): string[] => {
  let startIndex = 0;
  let endIndex = lines.length;
  while (startIndex < endIndex && lines[startIndex].trim().length === 0) {
    startIndex += 1;
  }
  while (endIndex > startIndex && lines[endIndex - 1].trim().length === 0) {
    endIndex -= 1;
  }

  return lines.slice(startIndex, endIndex);
};

const stripByteOrderMark = (value: string): string =>
  value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
