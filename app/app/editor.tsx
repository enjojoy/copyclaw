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

type SuggestedEdit = {
  id: string
  original: string
  replacement: string
  description: string
  status: 'pending' | 'accepted' | 'rejected'
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  type?: 'rewrite' | 'generate' | 'text' | 'suggested-edits'
  original?: string
  rewritten?: string
  status?: 'pending' | 'accepted' | 'rejected'
  from?: number
  to?: number
  edits?: SuggestedEdit[]
}

type Doc = {
  id: string
  title: string
  html: string
  createdAt?: number
  updatedAt: number
}

function docTitle(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  const text = div.textContent?.trim() ?? ''
  if (!text) return 'Untitled'
  return text.length > 40 ? text.slice(0, 40) + '...' : text
}

async function fetchDocs(): Promise<Doc[]> {
  try {
    const res = await fetch(`${OPENCLAW_URL}/copyclaw/docs`)
    const data = await res.json()
    return data.docs ?? []
  } catch { return [] }
}

async function apiCreateDoc(doc: { id?: string; title?: string; html?: string }): Promise<Doc | null> {
  try {
    const res = await fetch(`${OPENCLAW_URL}/copyclaw/docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    })
    const data = await res.json()
    return data.doc ?? null
  } catch { return null }
}

async function apiUpdateDoc(id: string, updates: { title?: string; html?: string }): Promise<void> {
  try {
    await fetch(`${OPENCLAW_URL}/copyclaw/docs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  } catch {}
}

async function apiDeleteDoc(id: string): Promise<void> {
  try {
    await fetch(`${OPENCLAW_URL}/copyclaw/docs/${id}`, { method: 'DELETE' })
  } catch {}
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
  const [editMode, setEditMode] = useState(false)
  const [pendingEdits, setPendingEdits] = useState<SuggestedEdit[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  const preEditHtmlRef = useRef<string>('')
  const [previewMode, setPreviewMode] = useState<'diff' | 'original' | 'changed'>('diff')

  const [docs, setDocs] = useState<Doc[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const skipSaveRef = useRef(false)

  // Load docs from server on mount, poll for new docs (e.g. created via Telegram)
  const loadDocsFromServer = useCallback(async () => {
    const loaded = await fetchDocs()
    if (loaded.length > 0) {
      setDocs(loaded)
      setActiveDocId(prev => {
        if (prev && loaded.some(d => d.id === prev)) return prev
        return loaded[0].id
      })
    } else if (docs.length === 0) {
      const created = await apiCreateDoc({ title: 'Untitled', html: '' })
      if (created) {
        setDocs([created])
        setActiveDocId(created.id)
      }
    }
  }, [])

  useEffect(() => {
    loadDocsFromServer()
    const interval = setInterval(loadDocsFromServer, 5000)
    return () => clearInterval(interval)
  }, [loadDocsFromServer])

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

      // Auto-save current doc to server (debounced via ref)
      if (!skipSaveRef.current && activeDocId) {
        const html = editor.getHTML()
        const title = docTitle(html)
        setDocs(prev => prev.map(d =>
          d.id === activeDocId ? { ...d, html, title, updatedAt: Date.now() } : d
        ))
        apiUpdateDoc(activeDocId, { html, title })
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
      const title = docTitle(html)
      setDocs(prev => prev.map(d =>
        d.id === activeDocId ? { ...d, html, title, updatedAt: Date.now() } : d
      ))
      apiUpdateDoc(activeDocId, { html, title })
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

  const createNewDoc = useCallback(async () => {
    if (!editor) return
    // Save current doc
    if (activeDocId) {
      const html = editor.getHTML()
      apiUpdateDoc(activeDocId, { html, title: docTitle(html) })
    }
    const created = await apiCreateDoc({ title: 'Untitled', html: '' })
    if (created) {
      setDocs(prev => [created, ...prev])
      skipSaveRef.current = true
      editor.commands.setContent('')
      skipSaveRef.current = false
      setActiveDocId(created.id)
      setChatMessages([])
      setWordCount(0)
      setCharCount(0)
    }
  }, [editor, activeDocId])

  const deleteDoc = useCallback(async (docId: string) => {
    if (docs.length <= 1) return
    await apiDeleteDoc(docId)
    setDocs(prev => {
      const updated = prev.filter(d => d.id !== docId)
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
    } else if (editMode) {
      // Suggest edits mode — document-wide multi-edit
      const userMsgId = crypto.randomUUID()
      addChatMessage({
        id: userMsgId,
        role: 'user',
        content: `\u270F\uFE0F Edit: ${userInput}`,
        type: 'text',
      })

      setChatLoading(true)
      try {
        const html = editor.getHTML()
        const res = await fetch(`${OPENCLAW_URL}/copyclaw/suggest-edits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, instruction: userInput }),
        })
        const data = await res.json()
        if (data.edits && data.edits.length > 0) {
          const edits: SuggestedEdit[] = data.edits.map((e: any) => ({
            id: crypto.randomUUID(),
            original: e.original,
            replacement: e.replacement,
            description: e.description,
            status: 'pending' as const,
          }))

          // Store pre-edit HTML and show preview of first edit
          preEditHtmlRef.current = editor.getHTML()
          setPendingEdits(edits)
          setReviewIndex(0)
          setPreviewMode('diff')

          // Show preview: apply first edit inline with markers
          showEditPreview(editor, edits[0], 'diff')

          addChatMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `${edits.length} suggested edit${edits.length > 1 ? 's' : ''}:`,
            type: 'suggested-edits',
            edits,
          })
        } else {
          addChatMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: data.error ?? 'No edits suggested.',
            type: 'text',
          })
        }
      } catch (err) {
        console.error(err)
        addChatMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Error: failed to get edit suggestions.',
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

  // Show a preview of the current edit in the editor using HTML replacement
  const showEditPreview = useCallback((ed: typeof editor, edit: SuggestedEdit, mode: 'diff' | 'original' | 'changed' = 'diff') => {
    if (!ed) return
    let html = preEditHtmlRef.current
    if (!html.includes(edit.original)) return

    let previewHtml: string
    if (mode === 'original') {
      // Show original with subtle highlight
      previewHtml = html.replace(
        edit.original,
        `<span style="background:rgba(239,68,68,0.1);border-bottom:2px solid rgba(239,68,68,0.4);padding:0 1px;border-radius:2px">${edit.original}</span>`
      )
    } else if (mode === 'changed') {
      // Show replacement applied with highlight
      previewHtml = html.replace(
        edit.original,
        `<span style="background:rgba(34,197,94,0.1);border-bottom:2px solid rgba(34,197,94,0.4);padding:0 1px;border-radius:2px">${edit.replacement}</span>`
      )
    } else {
      // Diff: show both
      previewHtml = html.replace(
        edit.original,
        `<span style="background:rgba(239,68,68,0.15);color:#f87171;text-decoration:line-through;padding:0 2px;border-radius:2px">${edit.original}</span>` +
        ` <span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:0 2px;border-radius:2px">${edit.replacement}</span>`
      )
    }

    skipSaveRef.current = true
    ed.commands.setContent(previewHtml)
    skipSaveRef.current = false
  }, [])

  const advanceReview = useCallback((msgId: string) => {
    if (!editor) return
    // Find next pending edit after current index
    let nextIdx = reviewIndex + 1
    const updatedEdits = pendingEdits
    while (nextIdx < updatedEdits.length && updatedEdits[nextIdx].status !== 'pending') {
      nextIdx++
    }
    if (nextIdx < updatedEdits.length) {
      setReviewIndex(nextIdx)
      setPreviewMode('diff')
      showEditPreview(editor, updatedEdits[nextIdx], 'diff')
    } else {
      // Done reviewing — apply final HTML
      skipSaveRef.current = true
      editor.commands.setContent(preEditHtmlRef.current)
      skipSaveRef.current = false
      setPendingEdits([])
      setReviewIndex(0)
    }
  }, [editor, reviewIndex, pendingEdits, showEditPreview])

  const acceptEdit = useCallback((msgId: string, editId: string) => {
    if (!editor) return
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg?.edits) return
    const edit = msg.edits.find(e => e.id === editId)
    if (!edit || edit.status !== 'pending') return

    // Apply this edit permanently to the base HTML
    if (preEditHtmlRef.current.includes(edit.original)) {
      preEditHtmlRef.current = preEditHtmlRef.current.replace(edit.original, edit.replacement)
    }

    // Update status
    const updatedEdits = msg.edits.map(e =>
      e.id === editId ? { ...e, status: 'accepted' as const } : e
    )
    updateChatMessage(msgId, { edits: updatedEdits })
    setPendingEdits(prev => prev.map(e => e.id === editId ? { ...e, status: 'accepted' as const } : e))

    advanceReview(msgId)
  }, [editor, chatMessages, updateChatMessage, advanceReview])

  const rejectEdit = useCallback((msgId: string, editId: string) => {
    if (!editor) return
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg?.edits) return

    const updatedEdits = msg.edits.map(e =>
      e.id === editId ? { ...e, status: 'rejected' as const } : e
    )
    updateChatMessage(msgId, { edits: updatedEdits })
    setPendingEdits(prev => prev.map(e => e.id === editId ? { ...e, status: 'rejected' as const } : e))

    advanceReview(msgId)
  }, [editor, chatMessages, updateChatMessage, advanceReview])

  const acceptAllEdits = useCallback((msgId: string) => {
    if (!editor) return
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg?.edits) return

    // Apply all pending edits to the base HTML
    let html = preEditHtmlRef.current
    for (const edit of msg.edits) {
      if (edit.status === 'pending' && html.includes(edit.original)) {
        html = html.replace(edit.original, edit.replacement)
      }
    }
    preEditHtmlRef.current = html
    skipSaveRef.current = true
    editor.commands.setContent(html)
    skipSaveRef.current = false

    setPendingEdits([])
    setReviewIndex(0)
    const updatedEdits = msg.edits.map(e =>
      e.status === 'pending' ? { ...e, status: 'accepted' as const } : e
    )
    updateChatMessage(msgId, { edits: updatedEdits })
  }, [editor, chatMessages, updateChatMessage])

  const rejectAllEdits = useCallback((msgId: string) => {
    if (!editor) return
    // Restore original HTML
    skipSaveRef.current = true
    editor.commands.setContent(preEditHtmlRef.current)
    skipSaveRef.current = false

    setPendingEdits([])
    setReviewIndex(0)
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg?.edits) return
    const updatedEdits = msg.edits.map(e =>
      e.status === 'pending' ? { ...e, status: 'rejected' as const } : e
    )
    updateChatMessage(msgId, { edits: updatedEdits })
  }, [editor, chatMessages, updateChatMessage])

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

          {/* Edit review bar */}
          {pendingEdits.length > 0 && pendingEdits.some(e => e.status === 'pending') && (() => {
            const current = pendingEdits[reviewIndex]
            const msgWithEdits = chatMessages.find(m => m.type === 'suggested-edits' && m.edits?.some(e => e.id === current?.id))
            const totalPending = pendingEdits.filter(e => e.status === 'pending').length
            const accepted = pendingEdits.filter(e => e.status === 'accepted').length
            const rejected = pendingEdits.filter(e => e.status === 'rejected').length
            return (
              <div className="border-b border-orange-800/30 bg-orange-950/20 px-4 py-2 flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-orange-400 font-medium">
                  Reviewing edit {reviewIndex + 1}/{pendingEdits.length}
                </span>
                {current && (
                  <span className="text-xs text-gray-400 truncate">{current.description}</span>
                )}
                {/* View toggle */}
                {current && (
                  <div className="flex bg-gray-800 rounded-lg overflow-hidden">
                    <button
                      onClick={() => { setPreviewMode('original'); showEditPreview(editor, current, 'original') }}
                      className={`px-2 py-1 text-xs transition-colors ${previewMode === 'original' ? 'bg-red-900/40 text-red-300' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      Original
                    </button>
                    <button
                      onClick={() => { setPreviewMode('diff'); showEditPreview(editor, current, 'diff') }}
                      className={`px-2 py-1 text-xs transition-colors ${previewMode === 'diff' ? 'bg-orange-900/40 text-orange-300' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      Diff
                    </button>
                    <button
                      onClick={() => { setPreviewMode('changed'); showEditPreview(editor, current, 'changed') }}
                      className={`px-2 py-1 text-xs transition-colors ${previewMode === 'changed' ? 'bg-green-900/40 text-green-300' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      Changed
                    </button>
                  </div>
                )}
                <div className="flex-1" />
                <span className="text-xs text-gray-600">
                  {accepted > 0 && <span className="text-green-500">{accepted} accepted</span>}
                  {accepted > 0 && rejected > 0 && ' \u00B7 '}
                  {rejected > 0 && <span className="text-gray-500">{rejected} rejected</span>}
                  {(accepted > 0 || rejected > 0) && ' \u00B7 '}
                  {totalPending} left
                </span>
                {msgWithEdits && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => acceptEdit(msgWithEdits.id, current.id)}
                      className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-xs font-medium transition-colors"
                    >
                      {'\u2713'} Accept
                    </button>
                    <button
                      onClick={() => rejectEdit(msgWithEdits.id, current.id)}
                      className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs font-medium transition-colors"
                    >
                      {'\u2715'} Skip
                    </button>
                    <button
                      onClick={() => acceptAllEdits(msgWithEdits.id)}
                      className="px-3 py-1 bg-green-900/50 hover:bg-green-800/50 rounded text-xs transition-colors text-green-400"
                    >
                      Accept all
                    </button>
                    <button
                      onClick={() => rejectAllEdits(msgWithEdits.id)}
                      className="px-3 py-1 bg-gray-800/50 hover:bg-gray-700/50 rounded text-xs transition-colors text-gray-500"
                    >
                      Dismiss all
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

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
                      <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    )}

                    {msg.type === 'suggested-edits' && msg.edits && (
                      <div className="space-y-2">
                        <div className="text-xs text-gray-400 font-medium">{msg.content}</div>
                        {/* Accept all / Reject all */}
                        {msg.edits.some(e => e.status === 'pending') && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => acceptAllEdits(msg.id)}
                              className="flex-1 py-1 bg-green-700 hover:bg-green-600 rounded-lg text-xs font-medium transition-colors"
                            >
                              {'\u2713'} Accept all
                            </button>
                            <button
                              onClick={() => rejectAllEdits(msg.id)}
                              className="flex-1 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-medium transition-colors"
                            >
                              {'\u2715'} Reject all
                            </button>
                          </div>
                        )}
                        {/* Individual edits */}
                        {msg.edits.map((edit, idx) => (
                          <div key={edit.id} className={`border rounded-lg overflow-hidden ${
                            edit.status === 'accepted' ? 'border-green-800/50 opacity-60' :
                            edit.status === 'rejected' ? 'border-gray-800 opacity-40' :
                            'border-gray-700'
                          }`}>
                            <div className="px-3 py-1.5 bg-gray-800/50 flex items-center gap-2">
                              <span className="text-xs text-gray-400 font-medium">#{idx + 1}</span>
                              <span className="text-xs text-gray-300">{edit.description}</span>
                              {edit.status === 'accepted' && <span className="ml-auto text-xs text-green-500">{'\u2713'}</span>}
                              {edit.status === 'rejected' && <span className="ml-auto text-xs text-gray-600">{'\u2715'}</span>}
                            </div>
                            <div className="px-3 py-2 space-y-1">
                              <div className="bg-red-950/30 rounded px-2 py-1 text-xs text-red-300/80 line-through"
                                dangerouslySetInnerHTML={{ __html: edit.original.replace(/<[^>]*>/g, ' ').trim() }} />
                              <div className="bg-green-950/30 rounded px-2 py-1 text-xs text-green-300/80"
                                dangerouslySetInnerHTML={{ __html: edit.replacement.replace(/<[^>]*>/g, ' ').trim() }} />
                            </div>
                            {edit.status === 'pending' && (
                              <div className="flex border-t border-gray-800">
                                <button
                                  onClick={() => acceptEdit(msg.id, edit.id)}
                                  className="flex-1 py-1.5 text-xs font-medium text-green-400 hover:bg-green-900/20 transition-colors"
                                >
                                  {'\u2713'} Accept
                                </button>
                                <button
                                  onClick={() => rejectEdit(msg.id, edit.id)}
                                  className="flex-1 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-800 transition-colors border-l border-gray-800"
                                >
                                  {'\u2715'} Reject
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
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
            {/* Edit mode toggle */}
            {!hasSelection && (
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setEditMode(prev => !prev)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    editMode
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {'\u270F\uFE0F'} Edit mode
                </button>
                <span className="text-xs text-gray-600">
                  {editMode ? 'Suggests changes to review one by one' : 'Chat freely with the AI'}
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder={
                  hasSelection ? 'Instruction for selected text...' :
                  editMode ? 'Describe changes to make...' :
                  'Ask to write something...'
                }
                className={`flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 placeholder-gray-500 ${
                  editMode ? 'bg-gray-800 focus:ring-orange-500 border border-orange-800/30' : 'bg-gray-800 focus:ring-orange-500'
                }`}
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
