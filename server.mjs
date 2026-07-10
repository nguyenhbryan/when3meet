import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDir = join(root, ".data");
const eventsFile = join(dataDir, "events.json");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

let vite;
if (!isProduction) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    server: { middlewareMode: true, host },
    appType: "spa",
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/events")) {
      await handleApi(request, response, url);
      return;
    }

    if (vite) {
      vite.middlewares(request, response, () => {
        response.writeHead(404);
        response.end("Not found");
      });
      return;
    }

    await serveStatic(url, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Something went wrong." });
  }
});

server.listen(port, host, () => {
  console.log(`When3Meet running at http://${host}:${port}/`);
});

async function handleApi(request, response, url) {
  const id = url.pathname.match(/^\/api\/events\/([^/]+)$/)?.[1];
  const responseMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/responses\/([^/]+)$/);
  const responseEventId = responseMatch?.[1];
  const responseId = responseMatch?.[2];

  if (request.method === "POST" && url.pathname === "/api/events") {
    const event = await readJsonBody(request);
    const events = await readEvents();
    const nextId = createEventId(events);
    events[nextId] = normalizeEvent(event);
    await writeEvents(events);
    sendJson(response, 201, { id: nextId, event: events[nextId] });
    return;
  }

  if (request.method === "POST" && responseEventId && url.pathname.endsWith("/responses/new")) {
    sendJson(response, 404, { error: "Response not found." });
    return;
  }

  if (request.method === "POST" && url.pathname.match(/^\/api\/events\/[^/]+\/responses$/)) {
    const eventId = url.pathname.match(/^\/api\/events\/([^/]+)\/responses$/)?.[1];
    const body = await readJsonBody(request);
    const events = await readEvents();
    const event = events[eventId];
    if (!event) {
      sendJson(response, 404, { error: "Event not found." });
      return;
    }

    const result = upsertEventResponse(event, body);
    if (!result.ok) {
      sendJson(response, 403, { error: result.error });
      return;
    }

    await writeEvents(events);
    sendJson(response, 200, { id: eventId, event });
    return;
  }

  if (request.method === "DELETE" && responseEventId && responseId) {
    const body = await readJsonBody(request);
    const events = await readEvents();
    const event = events[responseEventId];
    if (!event) {
      sendJson(response, 404, { error: "Event not found." });
      return;
    }

    const result = deleteEventResponse(event, responseId, body);
    if (!result.ok) {
      sendJson(response, result.status, { error: result.error });
      return;
    }

    await writeEvents(events);
    sendJson(response, 200, { id: responseEventId, event });
    return;
  }

  if (request.method === "GET" && id) {
    const events = await readEvents();
    const event = events[id];
    if (!event) {
      sendJson(response, 404, { error: "Event not found." });
      return;
    }
    sendJson(response, 200, { id, event });
    return;
  }

  sendJson(response, 405, { error: "Unsupported request." });
}

async function readEvents() {
  await mkdir(dataDir, { recursive: true });
  try {
    return JSON.parse(await readFile(eventsFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeEvents(events) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(eventsFile, `${JSON.stringify(events, null, 2)}\n`);
}

function createEventId(events) {
  let id = "";
  do {
    id = crypto.randomBytes(5).toString("base64url");
  } while (events[id]);
  return id;
}

function normalizeEvent(event) {
  return {
    title: String(event?.title ?? "").slice(0, 120),
    startDate: String(event?.startDate ?? ""),
    endDate: String(event?.endDate ?? ""),
    responses: Array.isArray(event?.responses) ? event.responses.map(normalizeResponse) : [],
  };
}

function normalizeResponse(response) {
  return {
    id: String(response?.id ?? crypto.randomUUID()),
    name: String(response?.name ?? "").slice(0, 80),
    dates: Array.isArray(response?.dates) ? response.dates.map(String) : [],
    ...(response?.password ? { password: String(response.password) } : {}),
  };
}

function upsertEventResponse(event, body) {
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const password = String(body?.password ?? "");
  const dates = Array.isArray(body?.dates) ? body.dates.map(String) : [];
  if (!name || dates.length === 0) {
    return { ok: false, error: "Name and dates are required." };
  }

  const existing = event.responses.find((response) => response.name.toLowerCase() === name.toLowerCase());
  if (existing?.password && existing.password !== password) {
    return { ok: false, error: "That password does not match this response." };
  }

  const savedPassword = password || existing?.password;
  const nextResponse = normalizeResponse({
    id: existing?.id ?? crypto.randomUUID(),
    name,
    dates,
    ...(savedPassword ? { password: savedPassword } : {}),
  });
  event.responses = [...event.responses.filter((response) => response.id !== existing?.id), nextResponse];
  return { ok: true };
}

function deleteEventResponse(event, responseId, body) {
  const name = String(body?.name ?? "").trim();
  const password = String(body?.password ?? "");
  const existing = event.responses.find((response) => response.id === responseId);
  if (!existing) {
    return { ok: false, status: 404, error: "Response not found." };
  }
  if (existing.name.toLowerCase() !== name.toLowerCase()) {
    return { ok: false, status: 403, error: "Only the response owner can delete it." };
  }
  if (existing.password && existing.password !== password) {
    return { ok: false, status: 403, error: "That password does not match this response." };
  }

  event.responses = event.responses.filter((response) => response.id !== responseId);
  return { ok: true };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function serveStatic(url, response) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requestedPath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, "dist", requestedPath);

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, { "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(join(root, "dist", "index.html")).pipe(response);
  }
}
