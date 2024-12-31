# Usage

Make sure a compatible version of Node.js is installed. Use NPM to install dependencies.

```
$ node -v
v22.12.0
$ npm -v
10.9.0
$ npm ci
```

Start worker process with the below command. For local testing, set `NODE_ENV` to
`test` will force worker to read log file from the same directory where `worker.ts`
resides instead of `/var/log`. The server listens on port `8080` by default and it can
be overwritten by setting env var `PORT` to a different value.

```
$ NODE_ENV=test node --experimental-strip-types worker.ts
```

Run tests

```
NODE_ENV=test node --experimental-strip-types test.ts
```

### Request

`GET /log/read` is the only exposed endpoint for retrieving logs from a particular log
file. Extra parameters can be added to the URL as query.

| Field Name | Required | Description |
| :--- | :--- | :--- |
| file   | Y | Log file name |
| cursor | N | Omitted on the first call. Use the returned `cursor` value for next call. |
| keyword | N | Retrieve logs that contain the given keyword. |
| limit  | N | Number of log entries to be returned. `batch` mode default 20, max 100. `stream` mode default 100 |
| mode   | N | Response mode: `batch` (default) or `stream`. |

- Example

```
$ curl -i -X GET 'http://localhost:8080/log/read?file=test.log&limit=2&mode=stream&cursor=null&keyword=xyz'
```

### Response

- Batch mode

2xx http status response

```ts
{
    hasMore: boolean;
    lines: string[];
    cursor?: number;
}
```

Non-2xx http status response

```ts
{
    msg: string;
}
```

- Stream mode events

```ts
{
    event: "log";
    data: {
        line: string
    };
}
```

```ts
{
    event: "pagination";
    data: {
        hasMore: boolean;
        cursor?: number;
    };
}
```

```ts
{
    event: "error";
    data: {
        msg: string;
    };
}
```

# Implementation

Based on the parameters received from request. The worker reads a particular log file
in reverse order starting from a specific offset. A fixed size buffer is used for storing
the read bytes to minimize memory consumption. Assume log entries are separated by a
newline character, and the max length of an entry will not exceed our buffer size.
Each entry (i.e. line) is extracted from the buffer and is either stored in memory
(in batch mode) or immediately sent to client (in stream mode). If a `keyword` is given,
only the entries that contain the keyword are returned. I thought about adding support
for filtering logs using regular expressions. Then we need to make sure we pick a good
regexp implementation (builtin or 3rd-party) to avoid expensive backtracking
caused by poorly written matching patterns.

Due to time constraints, UI and primery server were not implemented. But their
implementation should be fairly straight forward with the given worker endpoint.
In order for the primary server to aggregate logs from multiple worker nodes.
We need some mechanism that can provide the current topology of the cluster so we can
fanout concurrent requests to multiple worker nodes and perform a k-way merge (with a heap)
based on timestamp or some other sequencing value so the response will be sorted.

