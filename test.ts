import assert from "node:assert";
import { join } from "node:path";
import { open } from "node:fs/promises";
import { LOG_DIR, readLogBatch, readLogStream } from "./handlers.ts";

const TEST_LOG_FILE = "__test.log";

(async () => {
    const handle = await open(join(LOG_DIR, TEST_LOG_FILE), "a+");
    await handle.truncate(0);
    await handle.writeFile(
        "1 aaaaaa\n" + // 9 bytes
        "2 bbbbbbbbbbbbbb\n" + // 17 bytes
        "3 cccccccccccc\n" + // 15 bytes
        "4 ddddddddd\n" + // 12 bytes
        "5 eeeee\n" + // 8 bytes
        "6 fff\n" + // 6 bytes
        "");

    const controller = new AbortController();

    const testCases = [
        {
            params: [
                controller.signal,
                TEST_LOG_FILE,
                "",
                Infinity,
                1,
            ],
            expected: {
                hasMore: true,
                lines: [
                    "6 fff",
                ],
                cursor: 61,
            },
        },
        {
            params: [
                controller.signal,
                TEST_LOG_FILE,
                "",
                Infinity,
                2,
            ],
            expected: {
                hasMore: true,
                lines: [
                    "6 fff",
                    "5 eeeee",
                ],
                cursor: 53,
            },
        },
        {
            params: [
                controller.signal,
                TEST_LOG_FILE,
                "",
                61,
                3,
            ],
            expected: {
                hasMore: true,
                lines: [
                    "5 eeeee",
                    "4 ddddddddd",
                    "3 cccccccccccc",
                ],
                cursor: 26,
            },
        },
        {
            params: [
                controller.signal,
                TEST_LOG_FILE,
                "ddd",
                61,
                3,
            ],
            expected: {
                hasMore: false,
                lines: [
                    "4 ddddddddd",
                ],
                cursor: undefined,
            },
        },
        {
            params: [
                controller.signal,
                TEST_LOG_FILE,
                "",
                53,
                4,
            ],
            expected: {
                hasMore: false,
                lines: [
                    "4 ddddddddd",
                    "3 cccccccccccc",
                    "2 bbbbbbbbbbbbbb",
                    "1 aaaaaa",
                ],
                cursor: undefined,
            },
        },
        {
            params: [
                controller.signal,
                TEST_LOG_FILE,
                "aaa",
                Infinity,
                10,
            ],
            expected: {
                hasMore: false,
                lines: [
                    "1 aaaaaa",
                ],
                cursor: undefined,
            },
        },
    ];

    for (const tc of testCases) {
        assert.deepEqual(await readLogBatch.apply(null, tc.params), tc.expected);
    }

    for (const tc of testCases) {
        let i = 0;
        for await (const chunk of readLogStream.apply(null, tc.params)) {
            switch (chunk.event) {
            case "log":
                assert.equal(chunk.data.line, tc.expected.lines[i++]);
                break;
            case "pagination":
                assert.equal(chunk.data.hasMore, tc.expected.hasMore);
                assert.equal(chunk.data.cursor, tc.expected.cursor);
                break;
            case "error":
                assert.fail("Getting error event: " + JSON.stringify({
                    testCase: tc,
                    event: chunk,
                }));
            default:
                assert.fail(`Unknown event: ${chunk.event}`);
            }
        }
        assert.equal(i, tc.expected.lines.length);
    }

})().then(_ => console.info("Tests passed.")).catch(console.error);

