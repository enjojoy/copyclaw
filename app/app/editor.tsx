'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'

const TONES = [
  { label: '\u{1F525} Punchier', value: 'punchier' },
  { label: '\u2702\uFE0F Shorter', value: 'shorter' },
  { label: '\u{1F9F5} Thread', value: 'twitter thread' },
  { label: '\u{1F4BC} LinkedIn', value: 'linkedin post' },
  { label: '\u{1F9D1}\u200D\u{1F4BB} Technical', value: 'more technical' },
  { label: '\u{1F4AC} Casual', value: 'more casual' },
]

const OPENCLAW_URL = process.env.NEXT_PUBLIC_OPENCLAW_URL ?? 'http://localhost:9513'

const EMOJI_GROUPS = [
  ['128516', '128525', '128514', '129300', '128564', '128293', '127881', '128640', '9989', '10060'],
  ['128077', '128079', '128170', '9996', '128591', '128075', '9757', '128072', '128073', '128588'],
  ['10084', '128153', '128156', '11088', '128165', '128142', '127942', '127941', '128161', '128276'],
  ['9200', '128197', '128736', '128269', '128270', '128279', '128221', '128218', '128203', '128196'],
]

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  type?: 'rewrite' | 'generate' | 'text'
  original?: string
  rewritten?: string
  status?: 'pending' | 'accepted' | 'rejected'
  from?: number
  to?: number
}

type Doc = {
  id: string
  title: string
  html: string
  updatedAt: number
}

function loadDocs(): Doc[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('copyclaw:docs')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveDocs(docs: Doc[]) {
  localStorage.setItem('copyclaw:docs', JSON.stringify(docs))
}

function docTitle(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  const text = div.textContent?.trim() ?? ''
  if (!text) return 'Untitled'
  return text.length > 40 ? text.slice(0, 40) + '...' : text
}

export default function Editor() {
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number; flipBelow: boolean } | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [chatSessionId] = useState(() => crypto.randomUUID())
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const [showTextDropdown, setShowTextDropdown] = useState(false)
  const textDropdownRef = useRef<HTMLDivElement>(null)

  const [docs, setDocs] = useState<Doc[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const skipSaveRef = useRef(false)

  // Load docs from localStorage on mount
  useEffect(() => {
    const loaded = loadDocs()
    if (loaded.length > 0) {
      setDocs(loaded)
      setActiveDocId(loaded[0].id)
    } else {
      const first: Doc = { id: crypto.randomUUID(), title: 'Untitled', html: '', updatedAt: Date.now() }
      setDocs([first])
      setActiveDocId(first.id)
      saveDocs([first])
    }
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
      if (textDropdownRef.current && !textDropdownRef.current.contains(e.target as Node)) {
        setShowTextDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({ placeholder: 'Paste or write your content here...' }),
    ],
    editorProps: {
      attributes: {
        class: 'max-w-none min-h-[400px] focus:outline-none text-gray-100 leading-relaxed',
      },
    },
    onUpdate({ editor }) {
      const text = editor.getText()
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      setWordCount(words)
      setCharCount(text.length)

      // Auto-save current doc
      if (!skipSaveRef.current && activeDocId) {
        const html = editor.getHTML()
        setDocs(prev => {
          const updated = prev.map(d =>
            d.id === activeDocId ? { ...d, html, title: docTitle(html), updatedAt: Date.now() } : d
          )
          saveDocs(updated)
          return updated
        })
      }
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection
      if (from === to) {
        setHasSelection(false)
        setBubblePos(null)
        return
      }
      setHasSelection(true)
      const { view } = editor
      const start = view.coordsAtPos(from)
      const end = view.coordsAtPos(to)
      const editorRect = view.dom.closest('.max-w-3xl')?.getBoundingClientRect()
      if (editorRect) {
        const spaceAbove = start.top - editorRect.top
        const flipBelow = spaceAbove < 120
        setBubblePos({
          top: flipBelow
            ? end.bottom - editorRect.top + 10
            : start.top - editorRect.top - 10,
          left: (start.left + end.left) / 2 - editorRect.left,
          flipBelow,
        })
      }
    },
  })

  const switchDoc = useCallback((docId: string) => {
    if (!editor || docId === activeDocId) return
    // Save current doc first
    if (activeDocId) {
      const html = editor.getHTML()
      setDocs(prev => {
        const updated = prev.map(d =>
          d.id === activeDocId ? { ...d, html, title: docTitle(html), updatedAt: Date.now() } : d
        )
        saveDocs(updated)
        return updated
      })
    }
    // Load new doc
    const doc = docs.find(d => d.id === docId)
    if (doc) {
      skipSaveRef.current = true
      editor.commands.setContent(doc.html || '')
      skipSaveRef.current = false
      setActiveDocId(docId)
      setChatMessages([])
      const text = editor.getText()
      setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0)
      setCharCount(text.length)
    }
  }, [editor, activeDocId, docs])

  const createNewDoc = useCallback(() => {
    if (!editor) return
    // Save current doc
    if (activeDocId) {
      const html = editor.getHTML()
      setDocs(prev => {
        const updated = prev.map(d =>
          d.id === activeDocId ? { ...d, html, title: docTitle(html), updatedAt: Date.now() } : d
        )
        saveDocs(updated)
        return updated
      })
    }
    const newDoc: Doc = { id: crypto.randomUUID(), title: 'Untitled', html: '', updatedAt: Date.now() }
    setDocs(prev => {
      const updated = [newDoc, ...prev]
      saveDocs(updated)
      return updated
    })
    skipSaveRef.current = true
    editor.commands.setContent('')
    skipSaveRef.current = false
    setActiveDocId(newDoc.id)
    setChatMessages([])
    setWordCount(0)
    setCharCount(0)
  }, [editor, activeDocId])

  const deleteDoc = useCallback((docId: string) => {
    if (docs.length <= 1) return // Don't delete last doc
    setDocs(prev => {
      const updated = prev.filter(d => d.id !== docId)
      saveDocs(updated)
      // If deleting active doc, switch to first remaining
      if (docId === activeDocId && editor && updated.length > 0) {
        const next = updated[0]
        skipSaveRef.current = true
        editor.commands.setContent(next.html || '')
        skipSaveRef.current = false
        setActiveDocId(next.id)
        setChatMessages([])
      }
      return updated
    })
  }, [docs, activeDocId, editor])

  // Load active doc into editor when it becomes available
  useEffect(() => {
    if (!editor || !activeDocId) return
    const doc = docs.find(d => d.id === activeDocId)
    if (doc && editor.getHTML() !== doc.html && !editor.getText().trim()) {
      skipSaveRef.current = true
      editor.commands.setContent(doc.html || '')
      skipSaveRef.current = false
    }
  }, [editor, activeDocId])

  const addChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages(prev => [...prev, msg])
  }, [])

  const updateChatMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setChatMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))
  }, [])

  const rewrite = useCallback(async (tone?: string) => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return

    const selectedText = editor.state.doc.textBetween(from, to)
    const fullText = editor.getText()
    const inst = tone ? `Rewrite as ${tone}` : instruction
    if (!inst.trim()) return

    const userMsgId = crypto.randomUUID()
    addChatMessage({
      id: userMsgId,
      role: 'user',
      content: inst,
      type: 'rewrite',
      original: selectedText,
    })

    setLoading(true)
    try {
      const res = await fetch(`${OPENCLAW_URL}/copyclaw/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedText, fullText, instruction: inst, tone }),
      })
      const data = await res.json()
      if (data.rewritten) {
        const msgId = crypto.randomUUID()
        addChatMessage({
          id: msgId,
          role: 'assistant',
          content: data.rewritten,
          type: 'rewrite',
          original: selectedText,
          rewritten: data.rewritten,
          status: 'pending',
          from,
          to,
        })
        editor.chain().focus().setTextSelection({ from, to }).setHighlight().run()
      }
    } catch (err) {
      console.error(err)
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Error: failed to get rewrite. Check console for details.',
        type: 'text',
      })
    } finally {
      setLoading(false)
      setInstruction('')
    }
  }, [editor, instruction, addChatMessage])

  const acceptRewrite = useCallback((msgId: string) => {
    if (!editor) return
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg || msg.status !== 'pending' || msg.from == null || msg.to == null) return

    editor.chain()
      .focus()
      .setTextSelection({ from: msg.from, to: msg.to })
      .unsetHighlight()
      .insertContent(msg.rewritten!)
      .run()
    updateChatMessage(msgId, { status: 'accepted' })
  }, [editor, chatMessages, updateChatMessage])

  const rejectRewrite = useCallback((msgId: string) => {
    if (!editor) return
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg || msg.status !== 'pending' || msg.from == null || msg.to == null) return

    editor.chain().focus().setTextSelection({ from: msg.from, to: msg.to }).unsetHighlight().run()
    updateChatMessage(msgId, { status: 'rejected' })
  }, [editor, chatMessages, updateChatMessage])

  const sendChat = useCallback(async () => {
    if (!editor || !chatInput.trim()) return

    const { from, to } = editor.state.selection
    const hasTextSelected = from !== to
    const selectedText = hasTextSelected ? editor.state.doc.textBetween(from, to) : ''
    const fullText = editor.getText()
    const userInput = chatInput.trim()

    setChatInput('')

    if (hasTextSelected) {
      // Treat as rewrite of selection
      const userMsgId = crypto.randomUUID()
      addChatMessage({
        id: userMsgId,
        role: 'user',
        content: userInput,
        type: 'rewrite',
        original: selectedText,
      })

      setChatLoading(true)
      try {
        const res = await fetch(`${OPENCLAW_URL}/copyclaw/rewrite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedText, fullText, instruction: userInput }),
        })
        const data = await res.json()
        if (data.rewritten) {
          const msgId = crypto.randomUUID()
          addChatMessage({
            id: msgId,
            role: 'assistant',
            content: data.rewritten,
            type: 'rewrite',
            original: selectedText,
            rewritten: data.rewritten,
            status: 'pending',
            from,
            to,
          })
          editor.chain().focus().setTextSelection({ from, to }).setHighlight().run()
        }
      } catch (err) {
        console.error(err)
        addChatMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Error: failed to get rewrite.',
          type: 'text',
        })
      } finally {
        setChatLoading(false)
      }
    } else {
      // Chat mode — conversational interaction with the agent
      const userMsgId = crypto.randomUUID()
      addChatMessage({
        id: userMsgId,
        role: 'user',
        content: userInput,
        type: 'text',
      })

      setChatLoading(true)
      try {
        const res = await fetch(`${OPENCLAW_URL}/copyclaw/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userInput,
            documentContext: fullText || undefined,
            sessionId: chatSessionId,
          }),
        })
        const data = await res.json()
        if (data.reply) {
          addChatMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: data.reply,
            type: 'text',
          })
        } else if (data.error) {
          addChatMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Error: ${data.error}`,
            type: 'text',
          })
        }
      } catch (err) {
        console.error(err)
        addChatMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Error: failed to reach the agent.',
          type: 'text',
        })
      } finally {
        setChatLoading(false)
      }
    }
  }, [editor, chatInput, addChatMessage])

  const insertGenerated = useCallback((msgId: string) => {
    if (!editor) return
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg || !msg.rewritten) return

    editor.chain().focus().insertContent(msg.rewritten).run()
    updateChatMessage(msgId, { status: 'accepted' })
  }, [editor, chatMessages, updateChatMessage])

  const dismissGenerated = useCallback((msgId: string) => {
    updateChatMessage(msgId, { status: 'rejected' })
  }, [updateChatMessage])

  return (
    <div className="h-screen bg-gray-950 text-gray-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          className="text-gray-400 hover:text-white transition-colors text-lg"
          title={sidebarOpen ? 'Hide documents' : 'Show documents'}
        >
          {'\u2630'}
        </button>
        <span className="text-2xl">{'\u{1F99E}'}</span>
        <h1 className="text-xl font-semibold tracking-tight">CopyClaw</h1>
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
          <span className="text-gray-700">|</span>
          <span>{charCount} chars</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Documents sidebar */}
        <nav className={`${sidebarOpen ? 'w-56' : 'w-0'} transition-all duration-200 border-r border-gray-800 bg-gray-900 flex flex-col overflow-hidden flex-shrink-0`}>
          <div className="px-3 py-3 border-b border-gray-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Documents</span>
            <button
              onClick={createNewDoc}
              className="text-xs px-2 py-1 bg-orange-600 hover:bg-orange-500 rounded-md font-medium transition-colors"
              title="New document"
            >
              + New
            </button>
          </div>
          <div className="flex-1 overflow-auto py-1">
            {docs.map(doc => (
              <div
                key={doc.id}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  doc.id === activeDocId ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`}
                onClick={() => switchDoc(doc.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{doc.title}</div>
                  <div className="text-xs text-gray-600">{new Date(doc.updatedAt).toLocaleDateString()}</div>
                </div>
                {docs.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-xs transition-opacity"
                    title="Delete"
                  >
                    {'\u2715'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </nav>

        {/* Editor area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Formatting toolbar */}
          {editor && (
            <div className="border-b border-gray-800 px-4 py-1.5 flex items-center gap-0.5 bg-gray-950 z-[100] relative flex-shrink-0">
              {/* Text type dropdown */}
              <div className="relative" ref={textDropdownRef}>
                <button
                  onClick={() => setShowTextDropdown(prev => !prev)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition-colors min-w-[110px]"
                >
                  <span>
                    {editor.isActive('heading', { level: 1 }) ? 'Heading' :
                     editor.isActive('heading', { level: 2 }) ? 'Subheading' :
                     'Body'}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-gray-500">
                    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {showTextDropdown && createPortal(
                  <div
                    style={{
                      position: 'fixed',
                      top: (textDropdownRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                      left: textDropdownRef.current?.getBoundingClientRect().left ?? 0,
                    }}
                    className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 z-[9999] w-[180px]"
                  >
                    <button
                      onClick={() => { editor.chain().focus().toggleHeading({ level: 1 }).run(); setShowTextDropdown(false) }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-800 transition-colors ${editor.isActive('heading', { level: 1 }) ? 'text-white' : 'text-gray-400'}`}
                    >
                      <span className="text-lg font-bold">Heading</span>
                      {editor.isActive('heading', { level: 1 }) && <span className="ml-auto text-orange-500">{'\u2713'}</span>}
                    </button>
                    <button
                      onClick={() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); setShowTextDropdown(false) }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-800 transition-colors ${editor.isActive('heading', { level: 2 }) ? 'text-white' : 'text-gray-400'}`}
                    >
                      <span className="text-base font-semibold">Subheading</span>
                      {editor.isActive('heading', { level: 2 }) && <span className="ml-auto text-orange-500">{'\u2713'}</span>}
                    </button>
                    <button
                      onClick={() => { editor.chain().focus().setParagraph().run(); setShowTextDropdown(false) }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-800 transition-colors ${!editor.isActive('heading') ? 'text-white' : 'text-gray-400'}`}
                    >
                      <span className="text-sm">Body</span>
                      {!editor.isActive('heading') && <span className="ml-auto text-orange-500">{'\u2713'}</span>}
                    </button>
                  </div>,
                  document.body
                )}
              </div>

              <div className="w-px h-5 bg-gray-800 mx-1" />

              {/* Bold / Italic / Strikethrough */}
              <button
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-colors ${editor.isActive('bold') ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                title="Bold"
              >
                B
              </button>
              <button
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm italic transition-colors ${editor.isActive('italic') ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                title="Italic"
              >
                I
              </button>
              <button
                onClick={() => editor.chain().focus().toggleStrike().run()}
                className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm line-through transition-colors ${editor.isActive('strike') ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                title="Strikethrough"
              >
                S
              </button>

              <div className="w-px h-5 bg-gray-800 mx-1" />

              {/* Lists */}
              <button
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${editor.isActive('bulletList') ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                title="Bullet list"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="3" cy="4" r="1.5"/><rect x="6" y="3" width="8" height="2" rx="0.5"/>
                  <circle cx="3" cy="8" r="1.5"/><rect x="6" y="7" width="8" height="2" rx="0.5"/>
                  <circle cx="3" cy="12" r="1.5"/><rect x="6" y="11" width="8" height="2" rx="0.5"/>
                </svg>
              </button>
              <button
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${editor.isActive('orderedList') ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                title="Numbered list"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{fontSize: '9px'}}>
                  <text x="1" y="5.5" fontSize="5" fontWeight="bold">1</text><rect x="6" y="3" width="8" height="2" rx="0.5"/>
                  <text x="1" y="9.5" fontSize="5" fontWeight="bold">2</text><rect x="6" y="7" width="8" height="2" rx="0.5"/>
                  <text x="1" y="13.5" fontSize="5" fontWeight="bold">3</text><rect x="6" y="11" width="8" height="2" rx="0.5"/>
                </svg>
              </button>
              <button
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${editor.isActive('blockquote') ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                title="Quote"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 3h2.5c.8 0 1.5.7 1.5 1.5v2c0 .8-.7 1.5-1.5 1.5H4v1.5c0 .8-.7 1.5-1.5 1.5H2V4.5C2 3.7 2.7 3 3.5 3H3zm7 0h2.5c.8 0 1.5.7 1.5 1.5v2c0 .8-.7 1.5-1.5 1.5H11v1.5c0 .8-.7 1.5-1.5 1.5H9V4.5c0-.8.7-1.5 1.5-1.5H10z"/>
                </svg>
              </button>

              <div className="w-px h-5 bg-gray-800 mx-1" />

              {/* Horizontal rule */}
              <button
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 transition-colors"
                title="Divider"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="2" y="7" width="12" height="2" rx="1"/>
                </svg>
              </button>

              {/* Code */}
              <button
                onClick={() => editor.chain().focus().toggleCode().run()}
                className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-mono transition-colors ${editor.isActive('code') ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                title="Inline code"
              >
                {'</>'}
              </button>

              {/* Emoji picker */}
              <div className="relative" ref={emojiPickerRef}>
                <button
                  onClick={() => setShowEmojiPicker(prev => !prev)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors ${showEmojiPicker ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                  title="Emoji"
                >
                  {'\u{1F600}'}
                </button>
                {showEmojiPicker && createPortal(
                  <div
                    style={{
                      position: 'fixed',
                      top: (emojiPickerRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                      left: emojiPickerRef.current?.getBoundingClientRect().left ?? 0,
                    }}
                    className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 z-[9999] w-[280px]"
                  >
                    <div className="grid grid-cols-10 gap-1">
                      {EMOJI_GROUPS.flat().map((cp) => (
                        <button
                          key={cp}
                          onClick={() => {
                            editor.chain().focus().insertContent(String.fromCodePoint(parseInt(cp))).run()
                            setShowEmojiPicker(false)
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800 text-base transition-colors"
                        >
                          {String.fromCodePoint(parseInt(cp))}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}
              </div>

              <div className="flex-1" />

              {/* Undo / Redo */}
              <button
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 transition-colors disabled:opacity-30"
                title="Undo"
              >
                {'\u21A9'}
              </button>
              <button
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 transition-colors disabled:opacity-30"
                title="Redo"
              >
                {'\u21AA'}
              </button>
            </div>
          )}

          <div className="flex-1 p-8 overflow-auto min-h-0">
          <div className="max-w-3xl mx-auto relative">
            {/* Floating toolbar */}
            {hasSelection && bubblePos && (
              <div
                ref={bubbleRef}
                style={{ top: bubblePos.top, left: bubblePos.left, transform: bubblePos.flipBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' }}
                className="absolute z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 flex flex-col gap-2 min-w-[320px]"
              >
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
                    {loading ? '...' : '\u21A9'}
                  </button>
                </div>
              </div>
            )}

            <EditorContent editor={editor} />
          </div>
          </div>
        </main>

        {/* Chat sidebar */}
        <aside className="w-96 border-l border-gray-800 flex flex-col bg-gray-900">
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wider">Chat</h2>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-gray-600 text-sm text-center mt-8">
                <p>Select text and use the toolbar to rewrite,</p>
                <p>or type below to ask the AI to write something.</p>
              </div>
            )}

            {chatMessages.map((msg) => (
              <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* User message */}
                {msg.role === 'user' && (
                  <div className="max-w-[85%]">
                    {msg.type === 'rewrite' && msg.original && (
                      <div className="text-xs text-gray-500 mb-1 truncate">
                        Rewriting: &ldquo;{msg.original.slice(0, 60)}{msg.original.length > 60 ? '...' : ''}&rdquo;
                      </div>
                    )}
                    <div className="bg-orange-600/20 border border-orange-800/40 rounded-lg px-3 py-2 text-sm">
                      {msg.content}
                    </div>
                  </div>
                )}

                {/* Assistant message */}
                {msg.role === 'assistant' && (
                  <div className="max-w-[85%]">
                    {msg.type === 'rewrite' && (
                      <>
                        <div className="mb-1">
                          <div className="text-xs text-gray-500 mb-1">Before</div>
                          <div className="bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 text-xs text-red-300 leading-relaxed">
                            {msg.original}
                          </div>
                        </div>
                        <div className="mb-2">
                          <div className="text-xs text-gray-500 mb-1">After</div>
                          <div className="bg-green-950/40 border border-green-900/50 rounded-lg px-3 py-2 text-xs text-green-300 leading-relaxed">
                            {msg.rewritten}
                          </div>
                        </div>
                        {msg.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => acceptRewrite(msg.id)}
                              className="flex-1 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg text-xs font-medium transition-colors"
                            >
                              {'\u2713'} Accept
                            </button>
                            <button
                              onClick={() => rejectRewrite(msg.id)}
                              className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-medium transition-colors"
                            >
                              {'\u2715'} Reject
                            </button>
                          </div>
                        )}
                        {msg.status === 'accepted' && (
                          <div className="text-xs text-green-500 font-medium">{'\u2713'} Accepted</div>
                        )}
                        {msg.status === 'rejected' && (
                          <div className="text-xs text-gray-500 font-medium">{'\u2715'} Rejected</div>
                        )}
                      </>
                    )}

                    {msg.type === 'generate' && (
                      <>
                        <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm leading-relaxed mb-2">
                          {msg.rewritten}
                        </div>
                        {msg.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => insertGenerated(msg.id)}
                              className="flex-1 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg text-xs font-medium transition-colors"
                            >
                              {'\u2713'} Insert
                            </button>
                            <button
                              onClick={() => dismissGenerated(msg.id)}
                              className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-medium transition-colors"
                            >
                              {'\u2715'} Dismiss
                            </button>
                          </div>
                        )}
                        {msg.status === 'accepted' && (
                          <div className="text-xs text-green-500 font-medium">{'\u2713'} Inserted</div>
                        )}
                        {msg.status === 'rejected' && (
                          <div className="text-xs text-gray-500 font-medium">{'\u2715'} Dismissed</div>
                        )}
                      </>
                    )}

                    {msg.type === 'text' && (
                      <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                        {msg.content}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {chatLoading && (
              <div className="flex items-start">
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400">
                  Thinking...
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div className="border-t border-gray-800 p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder={hasSelection ? 'Instruction for selected text...' : 'Ask to write something...'}
                className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder-gray-500"
              />
              <button
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {chatLoading ? '...' : '\u{2191}'}
              </button>
            </div>
            {hasSelection && (
              <div className="text-xs text-orange-400/60 mt-1.5">Text selected — message will rewrite selection</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
