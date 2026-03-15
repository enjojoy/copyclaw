import type { PluginApi } from "openclaw/plugin-sdk/core";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Document storage ──────────────────────────────────────────────

type Doc = {
  id: string;
  title: string;
  html: string;
  createdAt: number;
  updatedAt: number;
};

function docsDir(api: PluginApi): string {
  const dir = path.join(api.runtime.state.resolveStateDir(), "copyclaw", "docs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function docPath(api: PluginApi, id: string): string {
  return path.join(docsDir(api), `${id}.json`);
}

function listDocs(api: PluginApi): Doc[] {
  const dir = docsDir(api);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  const docs: Doc[] = [];
  for (const f of files) {
    try {
      docs.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
    } catch {}
  }
  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

function getDoc(api: PluginApi, id: string): Doc | null {
  try {
    return JSON.parse(fs.readFileSync(docPath(api, id), "utf-8"));
  } catch {
    return null;
  }
}

function saveDoc(api: PluginApi, doc: Doc): void {
  fs.writeFileSync(docPath(api, doc.id), JSON.stringify(doc));
}

function deleteDocFile(api: PluginApi, id: string): boolean {
  try {
    fs.unlinkSync(docPath(api, id));
    return true;
  } catch {
    return false;
  }
}

function titleFromHtml(html: string): string {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled";
  return text.length > 60 ? text.slice(0, 60) + "..." : text;
}

// ── Plugin entry ──────────────────────────────────────────────────

export default function register(api: PluginApi) {
  const cfg = api.config?.plugins?.entries?.copyclaw?.config ?? {};
  const corsOrigin = cfg.corsOrigin ?? "http://localhost:3000";

  function setCorsHeaders(res: any) {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  function handleCors(req: any, res: any): boolean {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }
    return false;
  }

  async function readBody(req: any): Promise<any> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  }

  function extractAssistantReply(messages: unknown[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;
      if (msg.role === "assistant" && msg.content) {
        return typeof msg.content === "string"
          ? msg.content.trim()
          : Array.isArray(msg.content)
            ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim()
            : "";
      }
    }
    return "";
  }

  function jsonResponse(res: any, status: number, data: any) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  }

  // ── Documents CRUD API ────────────────────────────────────────

  // GET /copyclaw/docs — list all documents
  // POST /copyclaw/docs — create a new document
  api.registerHttpRoute({
    path: "/copyclaw/docs",
    auth: "plugin",
    match: "exact",
    handler: async (req, res) => {
      if (handleCors(req, res)) return true;

      if (req.method === "GET") {
        const docs = listDocs(api);
        jsonResponse(res, 200, { docs });
        return true;
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        const id = body.id ?? crypto.randomUUID();
        const now = Date.now();
        const doc: Doc = {
          id,
          title: body.title ?? titleFromHtml(body.html ?? ""),
          html: body.html ?? "",
          createdAt: now,
          updatedAt: now,
        };
        saveDoc(api, doc);
        jsonResponse(res, 201, { doc });
        return true;
      }

      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return true;
    },
  });

  // GET/PUT/DELETE /copyclaw/docs/:id
  api.registerHttpRoute({
    path: "/copyclaw/docs/",
    auth: "plugin",
    match: "prefix",
    handler: async (req, res) => {
      if (handleCors(req, res)) return true;

      const url = new URL(req.url ?? "", "http://localhost");
      const id = url.pathname.replace("/copyclaw/docs/", "").replace(/\/$/, "");

      if (!id) {
        jsonResponse(res, 400, { error: "Missing document ID" });
        return true;
      }

      if (req.method === "GET") {
        const doc = getDoc(api, id);
        if (!doc) { jsonResponse(res, 404, { error: "Not found" }); return true; }
        jsonResponse(res, 200, { doc });
        return true;
      }

      if (req.method === "PUT") {
        const body = await readBody(req);
        const existing = getDoc(api, id);
        const now = Date.now();
        const doc: Doc = {
          id,
          title: body.title ?? titleFromHtml(body.html ?? existing?.html ?? ""),
          html: body.html ?? existing?.html ?? "",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        saveDoc(api, doc);
        jsonResponse(res, 200, { doc });
        return true;
      }

      if (req.method === "DELETE") {
        const deleted = deleteDocFile(api, id);
        jsonResponse(res, deleted ? 200 : 404, { ok: deleted });
        return true;
      }

      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return true;
    },
  });

  // ── Agent tool: copyclaw_create_article ────────────────────────

  api.registerTool({
    name: "copyclaw_create_article",
    description: "Create a new article/document in CopyClaw, the AI writing editor. Use this when the user asks you to create, write, or draft an article, blog post, or document in CopyClaw. The article will appear in the CopyClaw editor for the user to review and edit.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the article",
        },
        content: {
          type: "string",
          description: "The article content in HTML format. Use <h1> for title, <h2> for subheadings, <p> for paragraphs, <strong> for bold, <em> for italic, <ul>/<ol>/<li> for lists, <blockquote> for quotes.",
        },
      },
      required: ["title", "content"],
    },
    async execute(_id: string, params: any) {
      try {
        const { title, content } = params;
        const id = crypto.randomUUID();
        const now = Date.now();

        // Wrap content with title if not already starting with h1
        const html = content.trim().startsWith("<h1")
          ? content
          : `<h1>${title}</h1>${content}`;

        const doc: Doc = {
          id,
          title,
          html,
          createdAt: now,
          updatedAt: now,
        };
        saveDoc(api, doc);

        return {
          content: [{
            type: "text" as const,
            text: `Article "${title}" created in CopyClaw (id: ${id}). The user can now open it in the CopyClaw editor to review and edit.`,
          }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: "text" as const,
            text: `Failed to create article: ${err.message}`,
          }],
        };
      }
    },
  });

  // ── Rewrite endpoint ──────────────────────────────────────────

  api.registerHttpRoute({
    path: "/copyclaw/rewrite",
    auth: "plugin",
    match: "exact",
    handler: async (req, res) => {
      if (handleCors(req, res)) return true;

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
      }

      try {
        const { selectedText, fullText, instruction, tone } = await readBody(req);

        if (!selectedText || !instruction) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "selectedText and instruction are required" }));
          return true;
        }

        const message = `You are acting as CopyClaw, a surgical AI writing editor.
You rewrite ONLY the selected text the user highlights, preserving the voice and flow of the surrounding content.

Rules:
- Return ONLY the rewritten version of the selected text
- Do not add commentary, explanations, or markdown formatting
- Match the existing tone of the full document unless instructed otherwise
- Keep roughly the same length unless asked to make it shorter or longer

Full document context:
---
${fullText}
---

Selected text to rewrite:
---
${selectedText}
---

Instruction: ${instruction}${tone ? `\nTone preset: ${tone}` : ""}

Return only the rewritten replacement for the selected text. No other output.`;

        const sessionKey = `copyclaw:rewrite:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const { runId } = await api.runtime.subagent.run({
          sessionKey,
          message,
          deliver: false,
          idempotencyKey: sessionKey,
        });

        const waitResult = await api.runtime.subagent.waitForRun({ runId, timeoutMs: 60_000 });
        if (waitResult.status !== "ok") {
          throw new Error(waitResult.error ?? `Subagent run failed: ${waitResult.status}`);
        }

        const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey, limit: 5 });
        const rewritten = extractAssistantReply(messages);

        api.runtime.subagent.deleteSession({ sessionKey }).catch(() => {});

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ rewritten }));
      } catch (err: any) {
        api.logger.error("CopyClaw rewrite error:", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message ?? "Internal error" }));
      }

      return true;
    },
  });

  // ── Chat endpoint ─────────────────────────────────────────────

  api.registerHttpRoute({
    path: "/copyclaw/chat",
    auth: "plugin",
    match: "exact",
    handler: async (req, res) => {
      if (handleCors(req, res)) return true;

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
      }

      try {
        const { message, documentContext, sessionId } = await readBody(req);

        if (!message) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "message is required" }));
          return true;
        }

        const sessionKey = `copyclaw:chat:${sessionId ?? "default"}`;

        const contextPreamble = documentContext
          ? `\n\n[Current document the user is working on]\n---\n${documentContext}\n---\n\n`
          : "";

        const fullMessage = `${contextPreamble}${message}`;

        const idempotencyKey = `${sessionKey}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const { runId } = await api.runtime.subagent.run({
          sessionKey,
          message: fullMessage,
          extraSystemPrompt: `You are CopyClaw, an AI writing assistant embedded in a text editor. The user is working on a document and chatting with you in a side panel.

You help them by:
- Brainstorming and ideating on content
- Suggesting text they can insert into their document
- Answering questions about writing, tone, structure
- Drafting paragraphs, sections, or full pieces when asked
- Giving feedback on their writing

Be conversational and helpful. When the user asks you to write or generate text, provide it directly. Keep responses focused and useful.`,
          deliver: false,
          idempotencyKey,
        });

        const waitResult = await api.runtime.subagent.waitForRun({ runId, timeoutMs: 60_000 });
        if (waitResult.status !== "ok") {
          throw new Error(waitResult.error ?? `Subagent run failed: ${waitResult.status}`);
        }

        const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey, limit: 50 });
        const reply = extractAssistantReply(messages);

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ reply }));
      } catch (err: any) {
        api.logger.error("CopyClaw chat error:", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message ?? "Internal error" }));
      }

      return true;
    },
  });

  // ── Suggest edits endpoint — document-wide multi-edit ────────

  api.registerHttpRoute({
    path: "/copyclaw/suggest-edits",
    auth: "plugin",
    match: "exact",
    handler: async (req, res) => {
      if (handleCors(req, res)) return true;

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
      }

      try {
        const { html, instruction } = await readBody(req);

        if (!html || !instruction) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "html and instruction are required" }));
          return true;
        }

        // Convert HTML to plain-ish text for the prompt, but keep the HTML for reference
        const message = `You are CopyClaw, an AI writing editor. The user wants you to suggest multiple edits to their document.

Instruction: ${instruction}

The document HTML is:
---
${html}
---

Analyze the document and suggest specific edits based on the instruction. Return ONLY a valid JSON array where each element is an object with:
- "original": the exact original HTML snippet to be replaced (must be an exact substring of the document HTML)
- "replacement": the new HTML to replace it with
- "description": a short 5-10 word description of the change

Rules:
- Each "original" must be a verbatim substring of the document HTML above
- Keep edits surgical — change only what's needed
- Return between 1 and 10 edits
- Return ONLY the JSON array, no markdown fences, no commentary

Example format:
[{"original":"<p>Some text here</p>","replacement":"<ul><li>Some text here</li></ul>","description":"Convert paragraph to bullet point"}]`;

        const sessionKey = `copyclaw:edits:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const { runId } = await api.runtime.subagent.run({
          sessionKey,
          message,
          deliver: false,
          idempotencyKey: sessionKey,
        });

        const waitResult = await api.runtime.subagent.waitForRun({ runId, timeoutMs: 90_000 });
        if (waitResult.status !== "ok") {
          throw new Error(waitResult.error ?? `Subagent run failed: ${waitResult.status}`);
        }

        const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey, limit: 5 });
        const reply = extractAssistantReply(messages);

        api.runtime.subagent.deleteSession({ sessionKey }).catch(() => {});

        // Parse the JSON array from the reply
        let edits: any[] = [];
        try {
          // Try to extract JSON from the reply (handle markdown fences if present)
          const jsonMatch = reply.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            edits = JSON.parse(jsonMatch[0]);
          }
        } catch (parseErr: any) {
          api.logger.error("CopyClaw suggest-edits parse error:", parseErr);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ edits: [], error: "Failed to parse edits from agent response" }));
          return true;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ edits }));
      } catch (err: any) {
        api.logger.error("CopyClaw suggest-edits error:", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message ?? "Internal error" }));
      }

      return true;
    },
  });

  // ── Health check ──────────────────────────────────────────────

  api.registerHttpRoute({
    path: "/copyclaw/health",
    auth: "plugin",
    match: "exact",
    handler: async (_req, res) => {
      setCorsHeaders(res);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, plugin: "copyclaw" }));
      return true;
    },
  });

  api.logger.info("CopyClaw plugin loaded — routes: /copyclaw/docs, /copyclaw/rewrite, /copyclaw/chat, /copyclaw/health | tools: copyclaw_create_article");
}
