#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const repoRoot = path.resolve(__dirname, "..");
const apiKey = process.env.OPENAI_API_KEY || "";
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const port = Number(process.argv[2] || process.env.PORT || 15312);
const MAX_SUMMARY_REPORTS = 100;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function text(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function contentTypeByExt(ext) {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".woff":
      return "font/woff";
    case ".ttf":
      return "font/ttf";
    case ".eot":
      return "application/vnd.ms-fontobject";
    default:
      return "application/octet-stream";
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function openaiResponsesCreate(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const parsed = raw ? JSON.parse(raw) : {};
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg =
              (parsed && parsed.error && parsed.error.message) ||
              ("OpenAI API error: " + res.statusCode);
            reject(new Error(msg));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function extractSummaryText(response) {
  function pushText(list, value) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        pushText(list, value[i]);
      }
      return;
    }
    if (typeof value === "string" && value.trim()) {
      list.push(value.trim());
      return;
    }
    if (value && typeof value === "object") {
      if (typeof value.value === "string" && value.value.trim()) {
        list.push(value.value.trim());
      }
      if (typeof value.text === "string" && value.text.trim()) {
        list.push(value.text.trim());
      }
      if (typeof value.output_text === "string" && value.output_text.trim()) {
        list.push(value.output_text.trim());
      }
    }
  }

  if (!response || typeof response !== "object") {
    return "";
  }
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  if (Array.isArray(response.output_text)) {
    const topLevel = [];
    for (let i = 0; i < response.output_text.length; i++) {
      pushText(topLevel, response.output_text[i]);
    }
    if (topLevel.length) {
      return topLevel.join("\n").trim();
    }
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks = [];

  for (let i = 0; i < output.length; i++) {
    const item = output[i] || {};
    pushText(chunks, item.text);
    pushText(chunks, item.output_text);
    const content = Array.isArray(item.content) ? item.content : [];
    for (let j = 0; j < content.length; j++) {
      const c = content[j] || {};
      pushText(chunks, c.text);
      pushText(chunks, c.output_text);
      pushText(chunks, c.content);
    }
  }

  if (!chunks.length && Array.isArray(response.choices)) {
    for (let i = 0; i < response.choices.length; i++) {
      const message = response.choices[i] && response.choices[i].message;
      if (!message) {
        continue;
      }
      pushText(chunks, message.content);
      if (Array.isArray(message.content)) {
        for (let j = 0; j < message.content.length; j++) {
          pushText(chunks, message.content[j] && message.content[j].text);
        }
      }
    }
  }

  return chunks.join("\n").trim();
}

function staticHandler(req, res) {
  const parsed = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(parsed.pathname || "/");
  if (pathname === "/") {
    pathname = "/index.html";
  }
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(repoRoot, safePath);
  if (!filePath.startsWith(repoRoot)) {
    text(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      text(res, 404, "Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypeByExt(path.extname(filePath)) });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleSummary(req, res) {
  if (!apiKey) {
    json(res, 500, { error: "OPENAI_API_KEY is not set on server" });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    json(res, 400, { error: "Failed to read request body" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch (err) {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const reports = Array.isArray(payload.reports) ? payload.reports.slice(0, MAX_SUMMARY_REPORTS) : [];
  if (!reports.length) {
    json(res, 400, { error: "reports is empty" });
    return;
  }

  const normalized = reports.map((r, i) => ({
    id: String((r && r.id) || "r" + i),
    label: String((r && r.label) || ""),
    desc: String((r && r.desc) || "").slice(0, 500),
  }));
  const reportLines = normalized
    .map((r, i) => `${i + 1}. [${r.id}] ${r.label}\n${r.desc}`)
    .join("\n\n");

  try {
    const openaiPayload = {
      model: model,
      input: [
        {
          role: "system",
          content:
            "あなたは災害リポート要約アシスタントです。事実ベースで簡潔に日本語でまとめてください。",
        },
        {
          role: "user",
          content:
            "以下は地図画面内のリポートです。次の形式で出力してください。\n" +
            "1) 全体傾向（2-3文）\n2) 主な話題（3点、箇条書き）\n3) 注意が必要な兆候（あれば1-2文）\n\n" +
            reportLines,
        },
      ],
      max_output_tokens: 420,
    };

    const response = await openaiResponsesCreate(openaiPayload);
    const summary = extractSummaryText(response);
    if (!summary) {
      json(res, 502, { error: "OpenAI returned empty summary" });
      return;
    }
    json(res, 200, { summary: summary });
  } catch (err) {
    json(res, 502, { error: err.message || "Summary generation failed" });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/summarize-visible") {
    await handleSummary(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    staticHandler(req, res);
    return;
  }
  text(res, 405, "Method Not Allowed");
});

server.listen(port, () => {
  console.log("summary server running at http://localhost:" + port);
  if (!apiKey) {
    console.log("OPENAI_API_KEY is not set; /api/summarize-visible will return 500");
  }
});
