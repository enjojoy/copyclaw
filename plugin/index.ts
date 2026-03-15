import type { PluginApi } from "openclaw/plugin-sdk/core";

export default function register(api: PluginApi) {
  const cfg = api.config?.plugins?.entries?.copyclaw?.config ?? {};
  const corsOrigin = cfg.corsOrigin ?? "http://localhost:3000";

  function setCorsHeaders(res: any) {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

  // Rewrite endpoint — surgical text replacement via a one-shot session
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

  // Chat endpoint — persistent conversational session for ideation & writing help
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

        // Persistent session per browser tab so conversation continues
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

  // Health check
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

  api.logger.info("CopyClaw plugin loaded — routes: /copyclaw/rewrite, /copyclaw/chat, /copyclaw/health");
}
