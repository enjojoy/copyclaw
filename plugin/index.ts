import type { PluginApi } from "openclaw/plugin-sdk/core";

export default function register(api: PluginApi) {
  const cfg = api.config?.plugins?.entries?.copyclaw?.config ?? {};
  const corsOrigin = cfg.corsOrigin ?? "http://localhost:3000";

  // CORS preflight
  api.registerHttpRoute({
    path: "/copyclaw/rewrite",
    auth: "plugin",
    match: "exact",
    handler: async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return true;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
      }

      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());

        const { selectedText, fullText, instruction, tone } = body;

        if (!selectedText || !instruction) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "selectedText and instruction are required" }));
          return true;
        }

        const systemPrompt = `You are CopyClaw, a surgical AI writing editor.
You rewrite ONLY the selected text the user highlights, preserving the voice and flow of the surrounding content.

Rules:
- Return ONLY the rewritten version of the selected text
- Do not add commentary, explanations, or markdown formatting
- Match the existing tone of the full document unless instructed otherwise
- Keep roughly the same length unless asked to make it shorter or longer`;

        const userPrompt = `Full document context:
---
${fullText}
---

Selected text to rewrite:
---
${selectedText}
---

Instruction: ${instruction}${tone ? `\nTone preset: ${tone}` : ""}

Return only the rewritten replacement for the selected text.`;

        // Call OpenAI directly (api.runtime.llm not yet in plugin SDK)
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) throw new Error("OPENAI_API_KEY not set in environment");

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 2000,
            temperature: 0.7,
          }),
        });

        const openaiData = await openaiRes.json();
        const rewritten = openaiData.choices?.[0]?.message?.content?.trim() ?? "";

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

  // Health check
  api.registerHttpRoute({
    path: "/copyclaw/health",
    auth: "plugin",
    match: "exact",
    handler: async (_req, res) => {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, plugin: "copyclaw" }));
      return true;
    },
  });

  api.logger.info("CopyClaw plugin loaded — routes: /copyclaw/rewrite, /copyclaw/health");
}
