import http from "node:http";
import { readLogBatch, readLogStream } from "./handlers.ts";

const PORT = process.env.PORT || "8080";

// TypeScript enum is not supported in strip-only mode,
// Using a plain object instead.
const ReadMode = Object.freeze({
    BATCH: "BATCH",
    STREAM: "STREAM",
});

const server = http.createServer(async (req, res) => {
    const i = req.url?.indexOf("?") || -1;

    const { path, qs } = i < 0
        ? { path: req.url, qs: null as unknown as string }
        : { path: req.url!.substring(0, i), qs: req.url!.substring(i+1) };

    switch (path) {
    case "/log/read": {
        if (req.method !== "GET") {
            return json(res, 405, { msg: "Unsupported HTTP method." });
        }

        const controller = new AbortController();
        req.on("aborted", () => controller.abort());

        const params = new URLSearchParams(qs);
        const cursor = parseInt(params.get("cursor")!);
        const file = params.get("file") || "";
        const keyword = params.get("keyword") || "";
        const limit = parseInt(params.get("limit")!);
        const mode = (params.get("mode") || ReadMode.BATCH).toUpperCase();

        switch (mode) {
        case ReadMode.BATCH:
            return readLogBatch(controller.signal,
                           file,
                           keyword,
                           cursor > 0 ? cursor : Infinity,
                           limit > 0 ? Math.min(limit, 100) : 20)
                .then(body => json(res, 200, body))
                .catch(err => {
                    if ((err as any)?.code === "ENOENT") {
                        json(res, 400, { msg: "Log file does not exist." });
                    } else {
                        console.error(`> ${req.url}\n`, err?.stack || err?.message || err);
                        json(res, 500, { msg: "Something went wrong." });
                    }
                });

        case ReadMode.STREAM: {
            try {
                res.writeHead(200, {
                    "x-accel-buffering": "no",
                    "content-type": "text/event-stream",
                    "cache-control": "no-cache",
                });
                const g = readLogStream(controller.signal,
                                        file,
                                        keyword,
                                        cursor > 0 ? cursor : Infinity,
                                        limit > 0 ? limit : 100);
                for await (const event of g) {
                    sse(res, event);
                }
            } catch (err) {
                if ((err as any)?.code === "ENOENT") {
                    sse(res, { event: "error", data: { msg: "Log file does not exist." } });
                } else {
                    console.error(`> ${req.url}\n`, err?.stack || err?.message || err);
                    sse(res, { event: "error", data: { msg: "Something went wrong." } });
                }
            }
            return res.end();
        }

        default:
            return json(res, 400, { msg: "Unsupported read mode." });
        }
    }

    default:
        json(res, 404, { msg: "Page not found." });
    }
});

server.listen(PORT, () => console.log("Listening on port:", PORT));

function json(res: http.ServerResponse, statusCode: number, body: any): void {
    body = JSON.stringify(body);
    res.writeHead(statusCode, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
    });
    res.write(body);
    res.end();
}

function sse(res: http.ServerResponse, body: { event: string; data: any }): void {
    res.write("event: ");
    res.write(body.event);
    res.write("\n");
    res.write("data: ");
    res.write(JSON.stringify(body.data));
    res.write("\n\n");
}

