# CopyClaw 🦞

AI-powered writing editor that connects to your OpenClaw instance. Highlight any text, give an instruction, and the agent rewrites just that selection.

## Features
- **Surgical rewrites** — highlight a selection, type an instruction, agent rewrites only that part
- **Tone presets** — one-click: Punchier, Shorter, Thread, LinkedIn, Technical, Casual
- **Before/After diff** — see the change, accept or reject
- **Powered by OpenClaw** — uses whatever model you have configured

## Setup

### 1. Install the OpenClaw plugin

Copy the `plugin/` directory to your OpenClaw extensions:

```bash
cp -r plugin/ ~/.openclaw/extensions/copyclaw
openclaw plugins enable copyclaw
openclaw gateway restart
```

Add to your `openclaw.json`:
```json
{
  "plugins": {
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

### 2. Run the Next.js app

```bash
cd app
cp .env.local.example .env.local
# Edit .env.local — set NEXT_PUBLIC_OPENCLAW_URL to your gateway URL (default: http://localhost:9513)
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. Paste or write your content in the editor
2. **Highlight** any text
3. A floating toolbar appears — click a tone preset or type a custom instruction
4. Review the Before/After diff in the sidebar
5. **Accept** or **Reject**

## Stack
- [Tiptap](https://tiptap.dev) — rich text editor
- [Next.js](https://nextjs.org) — React framework
- [OpenClaw](https://openclaw.ai) — AI backend
