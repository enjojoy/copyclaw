'use client'

import { useState, useCallback } from 'react'
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'

const TONES = [
  { label: '🔥 Punchier', value: 'punchier' },
  { label: '✂️ Shorter', value: 'shorter' },
  { label: '🧵 Thread', value: 'twitter thread' },
  { label: '💼 LinkedIn', value: 'linkedin post' },
  { label: '🧑‍💻 Technical', value: 'more technical' },
  { label: '💬 Casual', value: 'more casual' },
]

const OPENCLAW_URL = process.env.NEXT_PUBLIC_OPENCLAW_URL ?? 'http://localhost:9513'

export default function Editor() {
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingRewrite, setPendingRewrite] = useState<{
    original: string
    rewritten: string
    from: number
    to: number
  } | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({ placeholder: 'Paste or write your content here...' }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none min-h-[400px] focus:outline-none text-gray-100 leading-relaxed',
      },
    },
  })

  const rewrite = useCallback(async (tone?: string) => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return

    const selectedText = editor.state.doc.textBetween(from, to)
    const fullText = editor.getText()
    const inst = tone ? `Rewrite as ${tone}` : instruction
    if (!inst.trim()) return

    setLoading(true)
    try {
      const res = await fetch(`${OPENCLAW_URL}/copyclaw/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedText, fullText, instruction: inst, tone }),
      })
      const data = await res.json()
      if (data.rewritten) {
        setPendingRewrite({ original: selectedText, rewritten: data.rewritten, from, to })
        // Highlight the selection to show pending state
        editor.chain().focus().setTextSelection({ from, to }).setHighlight().run()
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [editor, instruction])

  const acceptRewrite = useCallback(() => {
    if (!editor || !pendingRewrite) return
    const { from, to, rewritten } = pendingRewrite
    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .unsetHighlight()
      .insertContent(rewritten)
      .run()
    setPendingRewrite(null)
    setInstruction('')
  }, [editor, pendingRewrite])

  const rejectRewrite = useCallback(() => {
    if (!editor || !pendingRewrite) return
    const { from, to } = pendingRewrite
    editor.chain().focus().setTextSelection({ from, to }).unsetHighlight().run()
    setPendingRewrite(null)
  }, [editor, pendingRewrite])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <span className="text-2xl">🦞</span>
        <h1 className="text-xl font-semibold tracking-tight">CopyClaw</h1>
        <span className="text-gray-500 text-sm ml-2">AI writing editor</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Editor area */}
        <main className="flex-1 p-8 overflow-auto">
          <div className="max-w-3xl mx-auto">
            {editor && (
              <BubbleMenu
                editor={editor}
                tippyOptions={{ duration: 100, placement: 'top' }}
                className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 flex flex-col gap-2 min-w-[320px]"
              >
                {/* Tone presets */}
                <div className="flex flex-wrap gap-1">
                  {TONES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => rewrite(t.value)}
                      disabled={loading}
                      className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {/* Custom instruction */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && rewrite()}
                    placeholder="Custom instruction..."
                    className="flex-1 bg-gray-800 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder-gray-500"
                  />
                  <button
                    onClick={() => rewrite()}
                    disabled={loading || !instruction.trim()}
                    className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {loading ? '...' : '↩'}
                  </button>
                </div>
              </BubbleMenu>
            )}

            <EditorContent editor={editor} />
          </div>
        </main>

        {/* Diff sidebar */}
        {pendingRewrite && (
          <aside className="w-80 border-l border-gray-800 p-6 flex flex-col gap-4 bg-gray-900">
            <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wider">Suggested rewrite</h2>

            <div>
              <p className="text-xs text-gray-500 mb-1">Before</p>
              <div className="bg-red-950/40 border border-red-900/50 rounded-lg p-3 text-sm text-red-300 leading-relaxed">
                {pendingRewrite.original}
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">After</p>
              <div className="bg-green-950/40 border border-green-900/50 rounded-lg p-3 text-sm text-green-300 leading-relaxed">
                {pendingRewrite.rewritten}
              </div>
            </div>

            <div className="flex gap-2 mt-auto">
              <button
                onClick={acceptRewrite}
                className="flex-1 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-medium transition-colors"
              >
                ✓ Accept
              </button>
              <button
                onClick={rejectRewrite}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
              >
                ✕ Reject
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
