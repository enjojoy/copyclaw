# CopyClaw 🦞

AI-powered writing editor that connects to your OpenClaw instance. Write, rewrite, and ideate — with an AI assistant built right in.

## Features

- **Surgical rewrites** — highlight a selection, type an instruction or pick a tone preset, accept or reject the change
- **Chat panel** — conversational AI sidebar for brainstorming, ideation, and writing help
- **Edit mode** — ask for document-wide changes and review them one by one with inline diff preview (original / diff / changed toggle)
- **Tone presets** — one-click rewrites: Punchier, Shorter, Thread, LinkedIn, Technical, Casual
- **Document management** — create, switch, and delete documents from the sidebar, all saved server-side
- **Formatting toolbar** — headings, bold, italic, strikethrough, lists, quotes, code, emoji picker, undo/redo
- **Telegram integration** — ask your OpenClaw bot to create articles via Telegram, they appear in the editor automatically
- **Word & character count** — live stats in the header
- **Powered by OpenClaw** — uses whatever model you have configured (Claude, GPT, local, etc.)

## Setup

### 1. Install the OpenClaw plugin

Copy the `plugin/` directory to your OpenClaw extensions:

```bash
cp -r plugin/ ~/.openclaw/extensions/copyclaw
openclaw plugins enable copyclaw
```

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "allow": ["copyclaw"],
    "entries": {
      "copyclaw": {
        "enabled": true,
        "config": {
          "corsOrigin": "http://localhost:3000"
        }
      }
    }
  }
}
```

To enable the Telegram article creation tool, add it to your tools allowlist:

```bash
openclaw config set tools.allow '["copyclaw_create_article"]'
openclaw gateway restart
```

### 2. Run the Next.js app

```bash
cd app
npm install
```

Create `.env.local` with your gateway URL:

```
NEXT_PUBLIC_OPENCLAW_URL=http://localhost:18789
```

Then start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

### Writing & Editing
1. Write or paste content in the editor
2. Use the formatting toolbar for headings, bold, lists, etc.
3. **Highlight** any text — a floating toolbar appears with tone presets and custom instructions
4. Review the rewrite in the chat panel, then **Accept** or **Reject**

### Chat
- Use the chat panel on the right to talk to the AI about your writing
- Ask for brainstorming ideas, feedback, drafts, or anything else
- The AI has full context of your current document

### Edit Mode
1. Toggle **Edit mode** in the chat panel
2. Describe the changes you want (e.g. "add more bullet points", "make the tone more casual")
3. The AI suggests multiple edits — review them one by one
4. Toggle between **Original**, **Diff**, and **Changed** views to see each edit in context
5. **Accept** or **Skip** each edit, or use **Accept all** / **Dismiss all**

### Telegram
Message your OpenClaw bot on Telegram to create articles:
> "Write a blog post about remote work tips and save it to CopyClaw"

The article appears in the documents sidebar within seconds.

## Stack
- [Tiptap](https://tiptap.dev) — rich text editor
- [Next.js](https://nextjs.org) — React framework
- [OpenClaw](https://openclaw.ai) — AI backend & agent runtime
