import { type FileHandle, open } from "node:fs/promises";
import { basename, join } from "node:path";

const BUF_SIZE = 4096;
const CHAR_LF = "\n".charCodeAt(0);
export const LOG_DIR = process.env.NODE_ENV === "test" ? import.meta.dirname : "/var/log";

export async function readLogBatch(
    signal: AbortSignal,
    file: string,
    keyword: string,
    cursor: number,
    limit: number,
): Promise<{
    hasMore: boolean;
    lines: string[];
    cursor?: number;
}> {
    const handle = await open(join(LOG_DIR, basename(file)), "r");

    let lines: string[] = [];
    let hasMore = false;

    try {
        let prevLineStart = cursor;
        for await (const { line, lineStart } of readLines(handle, keyword, cursor)) {
            if (signal.aborted) {
                hasMore = prevLineStart > 0;
                cursor = prevLineStart;
                break;
            } else if (lines.push(line) >= limit) {
                hasMore = lineStart > 0;
                cursor = lineStart;
                break;
            }
            prevLineStart = lineStart;
        }
    } finally {
        handle.close().catch(console.error);
    }

    return { hasMore, lines, cursor: hasMore ? cursor : undefined };
}

export async function* readLogStream(
    signal: AbortSignal,
    file: string,
    keyword: string,
    cursor: number,
    limit: number,
): AsyncGenerator<{
    event: "log";
    data: { line: string };
} | {
    event: "pagination";
    data: { hasMore: boolean; cursor?: number };
}> {
    const handle = await open(join(LOG_DIR, basename(file)), "r");

    let hasMore = false;

    try {
        let prevLineStart = cursor;
        let count = 0;
        for await (const { line, lineStart } of readLines(handle, keyword, cursor)) {
            if (signal.aborted || count >= limit) {
                hasMore = prevLineStart > 0;
                cursor = prevLineStart;
                break;
            }
            yield { event: "log", data: { line } };
            count++;
            prevLineStart = lineStart;
        }
    } finally {
        handle.close().catch(console.error);
    }

    yield {
        event: "pagination",
        data: { hasMore, cursor: hasMore ? cursor : undefined },
    };
}

async function* readLines(handle: FileHandle, keyword: string, cursor: number): AsyncGenerator<{ line: string; lineStart: number }> {
    const stat = await handle.stat();
    const pair = { line: null as unknown as string, lineStart: -1 };

    let end = Math.min(cursor, stat.size);
    let position = Math.max(0, end - BUF_SIZE); // where to start reading the file
    let buf = Buffer.alloc(end - position);
    let foundLF = false;

    while (true) {
        const { bytesRead } = await handle.read(buf, { position });

        let i = bytesRead-1, j = bytesRead, line = null as unknown as Buffer;
        while (i >= 0) {
            if (buf[i] === CHAR_LF) {
                if (foundLF) {
                    line = buf.subarray(i+1, j);
                    if (line.includes(keyword)) {
                        pair.line = line.toString();
                        pair.lineStart = position + i + 1;
                        yield pair;
                    }
                } else {
                    foundLF = true;
                }
                j = i;
            } else if (foundLF && position+i === 0) {
                line = buf.subarray(i, j);
                if (line.includes(keyword)) {
                    pair.line = line.toString();
                    pair.lineStart = position + i;
                    yield pair;
                }
            }
            i--;
        }

        if (position <= 0 || j >= bytesRead) {
            break;
        }

        end = position + j;
        buf = buf.subarray(0, Math.min(end, BUF_SIZE));
        position = Math.max(0, end - buf.byteLength);
        foundLF = false;
    }
}

