import React, { useState, useEffect, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { createClient } from "@supabase/supabase-js"
import { Search, Plus, ExternalLink, Loader2, X, ArrowRight, ArrowLeft, Pencil, Check, Trash2, RefreshCw, Upload } from "lucide-react"

const SUPABASE_URL = "https://sobwdyjbgecipxhvhrtu.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_5_Y3NIGFNQK-zyyE_DVKcA_tpclZ9g8"
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/characterize-links`
const CLUSTER_FN_URL = `${SUPABASE_URL}/functions/v1/cluster-links`
const SEARCH_FN_URL = `${SUPABASE_URL}/functions/v1/search-all`
const CHARACTERIZE_VISUAL_URL = `${SUPABASE_URL}/functions/v1/characterize-visual`
const CLUSTER_VISUALS_FN_URL = `${SUPABASE_URL}/functions/v1/cluster-visuals`
const SAVE_THOUGHT_URL = `${SUPABASE_URL}/functions/v1/save-thought`

// Precomputed clip-path: large rectangle minus counter-clockwise circles (non-zero winding = holes)
const PANEL_NOTCH_CLIP = (() => {
  const r = 9, spacing = 40, W = 9999, count = 250
  const parts = [`M 0 0 L ${W} 0 L ${W} ${count * spacing} L 0 ${count * spacing} Z`]
  for (let i = 0; i < count; i++) {
    const cy = spacing / 2 + i * spacing
    parts.push(`M 0 ${cy - r} A ${r} ${r} 0 0 0 0 ${cy + r} A ${r} ${r} 0 0 0 0 ${cy - r} Z`)
  }
  return `path("${parts.join(" ")}")`
})()

const supabase = (globalThis as Record<string, unknown>).__supabase as ReturnType<typeof createClient> ||
  (() => {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    ;(globalThis as Record<string, unknown>).__supabase = client
    return client
  })()

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? SUPABASE_ANON_KEY}` }
}

interface SavedLink {
  id: string
  url: string
  title: string
  slug: string
  description: string
  image_url: string
  user_note: string
  summary: string
  category: string
  vibe: string
  tags: string[]
  platform: string
  created_at: string
}

interface ParsedLink {
  url: string
  note: string
  platform: string
}

interface SavedVisual {
  id: string
  storage_path: string
  public_url: string
  title: string
  slug: string
  description: string
  vibe: string[]
  tags: string[]
  category: string | null
  moodboard_id: string | null
  user_note: string
  created_at: string
}

interface Moodboard {
  id: string
  name: string
}

interface SavedThought {
  id: string
  content: string
  created_at: string
}

type SearchResultItem =
  | (SavedLink & { type: "link" })
  | (SavedVisual & { type: "visual" })
  | (SavedThought & { type: "thought" })

// Stack paper colors cycling per category
const STACK_PALETTES = [
  { back: "#FFDEB3", mid: "#FFE1A1", front: "#FCF9F5" },
  { back: "#FFD4C2", mid: "#FFDEB3", front: "#FFF8F0" },
  { back: "#FFE1A1", mid: "#FCF9F5", front: "#FFFFFF" },
  { back: "#F4D4B8", mid: "#FFE8CC", front: "#FCF9F5" },
  { back: "#E8F0D8", mid: "#F0F5E8", front: "#FAFFF5" },
  { back: "#D8E8F0", mid: "#E8F4F8", front: "#F5FBFF" },
]

function detectPlatform(url: string): string {
  const u = url.toLowerCase()
  if (u.includes("x.com") || u.includes("twitter.com")) return "twitter"
  if (u.includes("linkedin.com")) return "linkedin"
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube"
  if (u.includes("instagram.com")) return "instagram"
  if (u.includes("github.com")) return "github"
  if (u.includes("dribbble.com")) return "dribbble"
  if (u.includes("behance.net")) return "behance"
  if (u.includes("figma.com")) return "figma"
  if (u.includes("tiktok.com")) return "tiktok"
  return "website"
}

function isSocialPlatform(platform: string): boolean {
  return ["twitter", "linkedin", "instagram", "tiktok"].includes(platform)
}

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s,\n"'<>)]+/gi
  const matches = text.match(urlRegex) || []
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?]+$/, "")))]
}

function getCardRotation(seed: string): number {
  const h = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return ((h % 9) - 4) * 0.45
}

function getThoughtRotation(seed: string): number {
  const h = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return ((h % 21) - 10) / 20
}

// ─── Thought mention helpers ────────────────────────────────────────────────

type MentionType = "tag" | "link" | "image" | "category"

const MENTION_COLORS: Record<MentionType, string> = {
  link: "#7B9E87",
  image: "#7B9E87",
  tag: "#C4A882",
  category: "#C4A882",
}

function getMentionQueryAtCaret(root: HTMLElement): string | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null
  const text = node.textContent || ""
  const uptoCaret = text.slice(0, range.startOffset)
  const match = uptoCaret.match(/@([a-zA-Z0-9_-]*)$/)
  return match ? match[1] : null
}

function insertMention(root: HTMLElement, queryLen: number, type: MentionType, value: string, label: string) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return
  const textNode = node as Text
  const caretOffset = range.startOffset
  const removeStart = Math.max(0, caretOffset - queryLen - 1)

  const before = (textNode.textContent || "").slice(0, removeStart)
  const after = (textNode.textContent || "").slice(caretOffset)
  textNode.textContent = before

  const span = document.createElement("span")
  span.textContent = label
  span.contentEditable = "false"
  span.dataset.mentionType = type
  span.dataset.mentionValue = value
  span.style.fontStyle = "italic"
  span.style.textDecoration = "underline"
  span.style.textDecorationColor = MENTION_COLORS[type]
  span.style.textUnderlineOffset = "2px"

  const spaceNode = document.createTextNode(" " + after)

  const parent = textNode.parentNode!
  parent.insertBefore(span, textNode.nextSibling)
  parent.insertBefore(spaceNode, span.nextSibling)

  const newRange = document.createRange()
  newRange.setStart(spaceNode, 1)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)
}

function serializeThoughtContent(root: HTMLElement): string {
  let out = ""
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || ""
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.dataset.mentionType && el.dataset.mentionValue) {
        out += `[[${el.dataset.mentionType}:${el.dataset.mentionValue}]]`
      } else if (el.tagName === "BR") {
        out += "\n"
      } else {
        out += el.textContent || ""
      }
    }
  }
  return out
}

const MENTION_REGEX = /\[\[(tag|link|image|category):([^\]]+)\]\]/g

function renderThoughtMentions(content: string, opts: {
  links: SavedLink[]
  visuals: SavedVisual[]
  onLinkClick: (l: SavedLink) => void
  onVisualClick: (v: SavedVisual) => void
  onTagClick: (tag: string) => void
  onCategoryClick: (category: string) => void
}): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = new RegExp(MENTION_REGEX.source, "g")
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index))
    const type = match[1] as MentionType
    const value = match[2]
    const label = type === "tag" ? `#${value}` : value
    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (type === "link") {
        const found = opts.links.find(l => l.slug === value)
        if (found) opts.onLinkClick(found)
      } else if (type === "image") {
        const found = opts.visuals.find(v => v.slug === value)
        if (found) opts.onVisualClick(found)
      } else if (type === "tag") {
        opts.onTagClick(value)
      } else if (type === "category") {
        opts.onCategoryClick(value)
      }
    }
    parts.push(
      <span
        key={key++}
        onClick={handleClick}
        className="italic underline cursor-pointer"
        style={{ textDecorationColor: MENTION_COLORS[type], textUnderlineOffset: "2px" }}
      >
        {label}
      </span>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex))
  return parts
}

// Resize on a canvas so the longest side is at most maxDim, returns a base64 data URL
function compressImageFile(file: File, maxDim = 1500): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      URL.revokeObjectURL(objectUrl)
      if (!ctx) { reject(new Error("Canvas not supported")); return }
      ctx.drawImage(img, 0, 0, width, height)
      const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg"
      resolve(canvas.toDataURL(mimeType, mimeType === "image/jpeg" ? 0.85 : undefined))
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Could not load image")) }
    img.src = objectUrl
  })
}

function recoverFields(link: SavedLink): Partial<SavedLink> {
  if (!link.summary?.includes('"summary"') || !link.summary?.includes('"category"')) return {}
  try {
    const m = link.summary.match(/\{[\s\S]*\}/)
    if (!m) return {}
    const p = JSON.parse(m[0])
    return { summary: p.summary || "", category: p.category || link.category, vibe: p.vibe || "", tags: Array.isArray(p.tags) ? p.tags : [] }
  } catch (_) { return {} }
}

// ─── Paper Card (individual link) ──────────────────────────────────────────

function PaperCard({ link, onClick, index }: { link: SavedLink; onClick: () => void; index: number }) {
  const rotation = getCardRotation(link.id)
  const vibes = link.vibe ? link.vibe.split(",").map(v => v.trim()).filter(Boolean) : []
  const tags = Array.isArray(link.tags) ? link.tags : []

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, rotate: rotation - 3 }}
      animate={{ opacity: 1, y: 0, rotate: rotation, transition: { delay: index * 0.04, type: "spring", stiffness: 300, damping: 24 } }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -6, rotate: 0, transition: { type: "spring", stiffness: 400, damping: 20 } }}
      onClick={onClick}
      className="cursor-pointer"
      style={{ transformOrigin: "center bottom" }}
    >
      <div
        className="bg-card rounded-sm overflow-hidden flex flex-col"
        style={{ border: "2px solid #0F0D0A", boxShadow: "4px 4px 0 #0F0D0A" }}
      >
        {link.image_url && (
          <div className="h-32 overflow-hidden bg-muted border-b-2 border-foreground shrink-0">
            <img
              src={link.image_url}
              alt={link.title}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none" }}
            />
          </div>
        )}
        <div className="p-4 flex-1 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-snug line-clamp-2 flex-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {link.title || (() => { try { return new URL(link.url).hostname } catch { return link.url } })()}
            </p>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="shrink-0 mt-0.5 opacity-50 hover:opacity-100"
            >
              <ExternalLink size={13} />
            </a>
          </div>
          {link.summary && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{link.summary}</p>
          )}
          {(vibes.length > 0 || tags.length > 0) && (
            <div className="flex flex-wrap gap-1 pt-1 mt-auto">
              {vibes.slice(0, 2).map(v => (
                <span key={v} className="text-xs px-2 py-0.5 rounded-sm bg-accent" style={{ border: "1px solid #0F0D0A" }}>{v}</span>
              ))}
              {tags.slice(0, 2).map(t => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-sm bg-muted opacity-70">#{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Visual Card (individual image) ────────────────────────────────────────

function VisualCard({ visual, onClick, index }: { visual: SavedVisual; onClick: () => void; index: number }) {
  const rotation = getCardRotation(visual.id)
  const vibes = Array.isArray(visual.vibe) ? visual.vibe : []

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, rotate: rotation - 3 }}
      animate={{ opacity: 1, y: 0, rotate: rotation, transition: { delay: index * 0.03, type: "spring", stiffness: 300, damping: 24 } }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -6, rotate: 0, transition: { type: "spring", stiffness: 400, damping: 20 } }}
      onClick={onClick}
      className="cursor-pointer break-inside-avoid mb-4 inline-block w-full"
      style={{ transformOrigin: "center bottom" }}
    >
      <div
        className="bg-card rounded-sm overflow-hidden flex flex-col"
        style={{ border: "2px solid #0F0D0A", boxShadow: "4px 4px 0 #0F0D0A" }}
      >
        <div className="overflow-hidden bg-muted border-b-2 border-foreground shrink-0">
          <img
            src={visual.public_url}
            alt={visual.title}
            className="w-full h-auto object-cover block"
            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none" }}
          />
        </div>
        <div className="p-3 flex flex-col gap-1.5">
          <p className="text-sm font-semibold leading-snug line-clamp-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            {visual.title || "Untitled"}
          </p>
          {vibes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {vibes.slice(0, 3).map(v => (
                <span key={v} className="text-xs px-2 py-0.5 rounded-sm bg-accent" style={{ border: "1px solid #0F0D0A" }}>{v}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Visual Upload Zone ─────────────────────────────────────────────────────

interface UploadingFile {
  id: string
  filename: string
  status: "compressing" | "uploading" | "error"
  error?: string
}

function VisualUploadZone({ onUploaded }: { onUploaded: (visual: SavedVisual) => void }) {
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState<UploadingFile[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  async function processFile(file: File) {
    const id = `${file.name}-${Date.now()}-${Math.random()}`
    setUploading(prev => [...prev, { id, filename: file.name, status: "compressing" }])
    try {
      const dataUrl = await compressImageFile(file)
      setUploading(prev => prev.map(u => u.id === id ? { ...u, status: "uploading" } : u))
      const response = await fetch(CHARACTERIZE_VISUAL_URL, {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({ image: dataUrl, filename: file.name }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to characterise image")
      }
      const { visual } = await response.json()
      if (visual) onUploaded(visual)
      setUploading(prev => prev.filter(u => u.id !== id))
    } catch (err) {
      setUploading(prev => prev.map(u => u.id === id ? { ...u, status: "error", error: err instanceof Error ? err.message : "Upload failed" } : u))
      setTimeout(() => setUploading(prev => prev.filter(u => u.id !== id)), 4000)
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return
    Array.from(fileList).filter(f => f.type.startsWith("image/")).forEach(processFile)
  }

  return (
    <div className="mb-8">
      <div
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-sm flex flex-col items-center justify-center gap-2 py-10 px-6 text-center transition-colors"
        style={{
          border: `2px dashed ${dragActive ? "#0F0D0A" : "rgba(15,13,10,0.3)"}`,
          background: dragActive ? "#FFE1A1" : "#FCF9F5",
        }}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={e => handleFiles(e.target.files)} />
        <Upload size={22} className="opacity-40" />
        <p className="text-sm font-medium">Drop images here, or click to select</p>
        <p className="text-xs text-muted-foreground opacity-50">PNG, JPG, GIF, WebP — resized to fit before upload</p>
      </div>

      {uploading.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {uploading.map(u => (
            <div
              key={u.id}
              className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-sm"
              style={{ border: "1.5px solid #0F0D0A", background: u.status === "error" ? "#FFF0EE" : "#FFF8F0" }}
            >
              {u.status === "error" ? (
                <span className="text-destructive">{u.filename}: {u.error}</span>
              ) : (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  <span>{u.filename} — {u.status === "compressing" ? "compressing" : "characterising"}...</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Thought Page (torn notebook page shell) ───────────────────────────────

function ThoughtPage({ children, rotation = 0, className = "" }: {
  children: React.ReactNode
  rotation?: number
  className?: string
}) {
  return (
    <div className={`thought-page ${className}`} style={{ transform: `rotate(${rotation}deg)` }}>
      <div className="thought-page-lines" />
      <div className="thought-page-margin" />
      <div className="thought-page-holes">
        <div className="thought-page-hole" />
        <div className="thought-page-hole" />
        <div className="thought-page-hole" />
      </div>
      <div className="thought-page-content">
        {children}
      </div>
    </div>
  )
}

// ─── Mention Dropdown ───────────────────────────────────────────────────────

function MentionDropdown({ tags, linksList, visualsList, categories, onSelect }: {
  tags: [string, number][]
  linksList: SavedLink[]
  visualsList: SavedVisual[]
  categories: string[]
  onSelect: (type: MentionType, value: string, label: string) => void
}) {
  const hasAny = tags.length > 0 || linksList.length > 0 || visualsList.length > 0 || categories.length > 0

  return (
    <div
      className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-sm"
      style={{ background: "#FFFFFF", border: "1.5px solid #0F0D0A", boxShadow: "3px 3px 0 #0F0D0A" }}
    >
      {!hasAny && <p className="text-xs text-muted-foreground px-3 py-3 opacity-50">No matches</p>}

      {tags.length > 0 && (
        <div className="py-1.5">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest opacity-40 mb-1">Tags</p>
          {tags.map(([tag, count]) => (
            <button
              key={tag}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onSelect("tag", tag, `#${tag}`)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent/40 flex items-center justify-between"
            >
              <span>#{tag}</span>
              <span className="text-xs opacity-40">{count}</span>
            </button>
          ))}
        </div>
      )}

      {linksList.length > 0 && (
        <div className="py-1.5 border-t" style={{ borderColor: "rgba(15,13,10,0.1)" }}>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest opacity-40 mb-1">Links</p>
          {linksList.map(l => (
            <button
              key={l.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onSelect("link", l.slug, l.slug)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent/40 flex items-center justify-between gap-2"
            >
              <span className="truncate">{l.slug || l.title}</span>
              <span className="text-xs opacity-40 shrink-0">{l.category}</span>
            </button>
          ))}
        </div>
      )}

      {visualsList.length > 0 && (
        <div className="py-1.5 border-t" style={{ borderColor: "rgba(15,13,10,0.1)" }}>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest opacity-40 mb-1">Images</p>
          {visualsList.map(v => (
            <button
              key={v.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onSelect("image", v.slug, v.slug)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent/40 flex items-center gap-2"
            >
              {v.public_url && <img src={v.public_url} alt="" className="w-5 h-5 rounded-sm object-cover shrink-0" />}
              <span className="truncate">{v.slug || v.title}</span>
            </button>
          ))}
        </div>
      )}

      {categories.length > 0 && (
        <div className="py-1.5 border-t" style={{ borderColor: "rgba(15,13,10,0.1)" }}>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest opacity-40 mb-1">Categories</p>
          {categories.map(c => (
            <button
              key={c}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onSelect("category", c, c)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent/40"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Thoughts Compose Box ───────────────────────────────────────────────────

function ThoughtsComposeBox({ links, visuals, onSaved }: {
  links: SavedLink[]
  visuals: SavedVisual[]
  onSaved: (thought: SavedThought) => void
}) {
  const composeRef = useRef<HTMLDivElement>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of links) {
      for (const t of (Array.isArray(l.tags) ? l.tags : [])) counts[t] = (counts[t] || 0) + 1
    }
    for (const v of visuals) {
      for (const t of (Array.isArray(v.tags) ? v.tags : [])) if (!(t in counts)) counts[t] = 0
    }
    return counts
  }, [links, visuals])

  const categories = useMemo(() => [...new Set([
    ...links.map(l => l.category).filter(Boolean),
    ...visuals.map(v => v.category).filter((c): c is string => Boolean(c)),
  ])].sort(), [links, visuals])

  function handleInput() {
    if (!composeRef.current) return
    setMentionQuery(getMentionQueryAtCaret(composeRef.current))
  }

  function handleSelect(type: MentionType, value: string, label: string) {
    if (!composeRef.current || mentionQuery === null) return
    insertMention(composeRef.current, mentionQuery.length, type, value, label)
    setMentionQuery(null)
    composeRef.current.focus()
  }

  async function handleSave() {
    if (!composeRef.current || saving) return
    const content = serializeThoughtContent(composeRef.current).trim()
    if (!content) return
    setSaving(true)
    try {
      const response = await fetch(SAVE_THOUGHT_URL, {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({ content }),
      })
      if (!response.ok) throw new Error("Failed to save")
      const { thought } = await response.json()
      if (thought) {
        onSaved(thought)
        composeRef.current.innerHTML = ""
        setMentionQuery(null)
      }
    } catch (_) { /* swallow — save button re-enables so the user can retry */ }
    setSaving(false)
  }

  const q = (mentionQuery || "").toLowerCase()
  const filteredTags = Object.entries(tagCounts).filter(([tag]) => tag.toLowerCase().includes(q)).slice(0, 6)
  const filteredLinks = links.filter(l =>
    [l.title, l.slug, l.vibe, ...(Array.isArray(l.tags) ? l.tags : [])].join(" ").toLowerCase().includes(q)
  ).slice(0, 6)
  const filteredVisuals = visuals.filter(v =>
    [v.title, v.slug].join(" ").toLowerCase().includes(q)
  ).slice(0, 6)
  const filteredCategories = categories.filter(c => c.toLowerCase().includes(q)).slice(0, 6)

  const firstMatch: { type: MentionType; value: string; label: string } | null =
    filteredTags.length ? { type: "tag", value: filteredTags[0][0], label: `#${filteredTags[0][0]}` } :
    filteredLinks.length ? { type: "link", value: filteredLinks[0].slug, label: filteredLinks[0].slug } :
    filteredVisuals.length ? { type: "image", value: filteredVisuals[0].slug, label: filteredVisuals[0].slug } :
    filteredCategories.length ? { type: "category", value: filteredCategories[0], label: filteredCategories[0] } :
    null

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSave()
      return
    }
    if (mentionQuery !== null) {
      if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return }
      if (e.key === "Enter") {
        e.preventDefault()
        if (firstMatch) handleSelect(firstMatch.type, firstMatch.value, firstMatch.label)
        return
      }
    }
    if (e.key === "Enter") {
      e.preventDefault()
      document.execCommand("insertText", false, "\n")
    }
  }

  return (
    <div className="relative mb-8">
      <ThoughtPage rotation={0}>
        <div
          ref={composeRef}
          contentEditable
          suppressContentEditableWarning
          data-placeholder="@ to mention · cmd+enter to save"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          className="thought-editable outline-none"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-40"
            style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A", boxShadow: "2px 2px 0 rgba(15,13,10,0.3)" }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
          </button>
        </div>
      </ThoughtPage>
      {mentionQuery !== null && (
        <MentionDropdown
          tags={filteredTags}
          linksList={filteredLinks}
          visualsList={filteredVisuals}
          categories={filteredCategories}
          onSelect={handleSelect}
        />
      )}
    </div>
  )
}

// ─── Thought Card ───────────────────────────────────────────────────────────

function ThoughtCard({ thought, links, visuals, onLinkClick, onVisualClick, onTagClick, onCategoryClick }: {
  thought: SavedThought
  links: SavedLink[]
  visuals: SavedVisual[]
  onLinkClick: (l: SavedLink) => void
  onVisualClick: (v: SavedVisual) => void
  onTagClick: (tag: string) => void
  onCategoryClick: (category: string) => void
}) {
  const rotation = getThoughtRotation(thought.id)
  const rendered = useMemo(
    () => renderThoughtMentions(thought.content, { links, visuals, onLinkClick, onVisualClick, onTagClick, onCategoryClick }),
    [thought.content, links, visuals]
  )

  return (
    <ThoughtPage rotation={rotation} className="mb-6">
      <p className="whitespace-pre-wrap" style={{ margin: 0 }}>{rendered}</p>
      <p className="text-xs opacity-40 mt-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        {new Date(thought.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
      </p>
    </ThoughtPage>
  )
}

// ─── Thought Snippet Card (for search results) ─────────────────────────────

function ThoughtSnippetCard({ thought, onClick, index }: { thought: SavedThought; onClick: () => void; index: number }) {
  const rotation = getThoughtRotation(thought.id)
  const snippet = thought.content.length > 120 ? thought.content.slice(0, 120) + "…" : thought.content

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.03, type: "spring", stiffness: 300, damping: 24 } }}
      exit={{ opacity: 0, scale: 0.9 }}
      onClick={onClick}
      className="cursor-pointer break-inside-avoid mb-4 inline-block w-full"
    >
      <ThoughtPage rotation={rotation}>
        <p style={{ margin: 0 }}>{snippet}</p>
        <p className="text-xs opacity-40 mt-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {new Date(thought.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </ThoughtPage>
    </motion.div>
  )
}

// ─── Thoughts View ──────────────────────────────────────────────────────────

function ThoughtsView({ thoughts, links, visuals, onSaved, onLinkClick, onVisualClick, onTagClick, onCategoryClick }: {
  thoughts: SavedThought[]
  links: SavedLink[]
  visuals: SavedVisual[]
  onSaved: (thought: SavedThought) => void
  onLinkClick: (l: SavedLink) => void
  onVisualClick: (v: SavedVisual) => void
  onTagClick: (tag: string) => void
  onCategoryClick: (category: string) => void
}) {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <ThoughtsComposeBox links={links} visuals={visuals} onSaved={onSaved} />
      {thoughts.map(t => (
        <ThoughtCard
          key={t.id}
          thought={t}
          links={links}
          visuals={visuals}
          onLinkClick={onLinkClick}
          onVisualClick={onVisualClick}
          onTagClick={onTagClick}
          onCategoryClick={onCategoryClick}
        />
      ))}
      {!thoughts.length && (
        <p className="text-sm text-muted-foreground opacity-50 text-center py-12">No thoughts yet — jot something down above.</p>
      )}
    </div>
  )
}

// ─── Category Stack ────────────────────────────────────────────────────────

function CategoryStack({ category, links, paletteIndex, onClick }: {
  category: string
  links: SavedLink[]
  paletteIndex: number
  onClick: () => void
}) {
  const palette = STACK_PALETTES[paletteIndex % STACK_PALETTES.length]
  const preview = links.slice(0, 3)

  return (
    <motion.div
      whileHover={{ y: -8, transition: { type: "spring", stiffness: 400, damping: 20 } }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className="cursor-pointer relative"
      style={{ width: 200, height: 240 }}
    >
      {/* Back paper */}
      <div
        className="absolute inset-0 rounded-sm"
        style={{
          background: palette.back,
          border: "2px solid #0F0D0A",
          transform: "rotate(-7deg) translate(-6px, 6px)",
          boxShadow: "3px 3px 0 #0F0D0A",
        }}
      />
      {/* Mid paper */}
      <div
        className="absolute inset-0 rounded-sm"
        style={{
          background: palette.mid,
          border: "2px solid #0F0D0A",
          transform: "rotate(-3deg) translate(-2px, 3px)",
          boxShadow: "3px 3px 0 #0F0D0A",
        }}
      />
      {/* Front paper */}
      <div
        className="absolute inset-0 rounded-sm flex flex-col p-5"
        style={{
          background: palette.front,
          border: "2px solid #0F0D0A",
          transform: "rotate(1deg)",
          boxShadow: "4px 4px 0 #0F0D0A",
        }}
      >
        {/* Red pin */}
        <div
          className="absolute rounded-full"
          style={{
            width: 14, height: 14,
            background: "#F53535",
            border: "2px solid #0F0D0A",
            top: 14, right: 18,
            boxShadow: "1px 1px 0 #0F0D0A",
          }}
        />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {links.length} {links.length === 1 ? "link" : "links"}
        </p>
        <h3 className="font-semibold leading-tight text-foreground flex-1" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.05rem" }}>
          {category}
        </h3>
        {preview.length > 0 && (
          <div className="space-y-1 mt-3">
            {preview.slice(0, 2).map(l => (
              <p key={l.id} className="text-xs text-muted-foreground truncate opacity-70">
                {l.title || (() => { try { return new URL(l.url).hostname } catch { return "" } })()}
              </p>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Link Detail Panel ─────────────────────────────────────────────────────

function LinkDetailPanel({ link, categories, onClose, onSave, onDelete }: {
  link: SavedLink
  categories: string[]
  onClose: () => void
  onSave: (updated: SavedLink) => void
  onDelete: (id: string) => void
}) {
  const recovered = recoverFields(link)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ ...link, ...recovered })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [recharacterising, setRecharacterising] = useState(false)
  const [tagsInput, setTagsInput] = useState(Array.isArray(draft.tags) ? draft.tags.join(", ") : "")

  async function handleSave() {
    setSaving(true)
    const updated = { ...draft, tags: tagsInput.split(",").map(t => t.trim()).filter(Boolean) }
    const { error } = await supabase.from("links").update({
      summary: updated.summary, category: updated.category, vibe: updated.vibe,
      tags: updated.tags, user_note: updated.user_note, title: updated.title,
    }).eq("id", link.id)
    if (!error) { onSave(updated); setEditing(false) }
    setSaving(false)
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    const { error } = await supabase.from("links").delete().eq("id", link.id)
    if (!error) { onDelete(link.id); onClose() }
    setDeleting(false)
  }

  async function handleRecharacterise() {
    setRecharacterising(true)
    try {
      const response = await fetch(EDGE_FN_URL, {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({ links: [{ url: link.url, note: link.user_note }] }),
      })
      if (!response.ok) throw new Error("Failed")
      const { results } = await response.json()
      if (results?.[0]) {
        const r = results[0]
        await supabase.from("links").update({ title: r.title || draft.title, slug: r.slug, summary: r.summary, category: r.category, vibe: r.vibe, tags: r.tags, image_url: r.image_url || draft.image_url }).eq("id", link.id)
        const updated = { ...draft, ...r, title: r.title || draft.title, image_url: r.image_url || draft.image_url }
        setDraft(updated)
        setTagsInput(Array.isArray(r.tags) ? r.tags.join(", ") : "")
        onSave(updated)
      }
    } catch (_) {}
    setRecharacterising(false)
  }

  const vibes = draft.vibe ? draft.vibe.split(",").map(v => v.trim()).filter(Boolean) : []
  const tags = Array.isArray(draft.tags) ? draft.tags : []

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex bg-black/20"
    >
      <div className="flex-1" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="w-full max-w-md flex flex-col relative"
      >
        {/* border SVG: sibling of the clipped panel, so it is NOT clipped — draws the full continuous notched stroke */}
        <svg
          style={{ position: "absolute", left: 0, top: 0, width: 14, height: "100%", pointerEvents: "none", zIndex: 20 }}
        >
          <defs>
            <pattern id="notchBorder" x="0" y="0" width="14" height="40" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 1 11 A 9 9 0 0 1 1 29 L 1 40" fill="none" stroke="#0F0D0A" strokeWidth="2" />
            </pattern>
          </defs>
          <rect width="14" height="100%" fill="url(#notchBorder)" />
        </svg>

        {/* panel: clip-path cuts everything inside to the notched shape — no child background can overpaint the holes */}
        <div
          className="flex flex-col overflow-y-auto flex-1"
          style={{ background: "#FCF9F5", clipPath: PANEL_NOTCH_CLIP }}
        >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 sticky top-0 z-10" style={{ background: "#FCF9F5", borderBottom: "2px solid #0F0D0A" }}>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium opacity-50 hover:opacity-100">
            <ExternalLink size={13} /> open link
          </a>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm transition-colors"
              style={{
                border: "1.5px solid",
                borderColor: confirmDelete ? "#E03D2F" : "rgba(15,13,10,0.3)",
                color: confirmDelete ? "#E03D2F" : "#6B5B4A",
                background: confirmDelete ? "#FFF0EE" : "transparent",
              }}
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {confirmDelete ? "Confirm?" : "Delete"}
            </button>
            {editing ? (
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm" style={{ background: "#0F0D0A", color: "#FFEADA", border: "1.5px solid #0F0D0A" }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
              </button>
            ) : (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm" style={{ border: "1.5px solid rgba(15,13,10,0.3)", color: "#6B5B4A" }}>
                <Pencil size={12} /> Edit
              </button>
            )}
            <button onClick={onClose} className="opacity-40 hover:opacity-100 ml-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {link.image_url && (
          <div className="h-44 overflow-hidden shrink-0" style={{ borderBottom: "2px solid #0F0D0A" }}>
            <img src={link.image_url} alt={link.title} className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = "none" }} />
          </div>
        )}

        <div className="px-6 py-6 space-y-6">
          {[
            { label: "Title", field: "title" as const, type: "input" },
          ].map(({ label, field, type }) => (
            <div key={field}>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
              {editing ? (
                <input className="w-full rounded-sm px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                  value={draft[field] as string} onChange={e => setDraft({ ...draft, [field]: e.target.value })} />
              ) : (
                <p className="text-sm font-medium">{draft[field] as string || "—"}</p>
              )}
            </div>
          ))}

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">URL</p>
            <p className="text-xs text-muted-foreground break-all opacity-60">{link.url}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Category</p>
            {editing ? (
              <select className="w-full rounded-sm px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <span className="text-sm px-3 py-1 rounded-sm inline-block" style={{ background: "#FFE1A1", border: "1.5px solid #0F0D0A" }}>{draft.category}</span>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Summary</p>
            {editing ? (
              <textarea rows={4} className="w-full rounded-sm px-3 py-2 text-sm resize-none" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} />
            ) : (
              <>
                <p className="text-sm text-muted-foreground leading-relaxed">{draft.summary || "—"}</p>
                <button onClick={handleRecharacterise} disabled={recharacterising} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2 disabled:opacity-40">
                  <RefreshCw size={11} className={recharacterising ? "animate-spin" : ""} />
                  {recharacterising ? "Re-characterising..." : "Re-characterise with AI"}
                </button>
              </>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Vibe</p>
            {editing ? (
              <input className="w-full rounded-sm px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                placeholder="minimal, dark, editorial..." value={draft.vibe} onChange={e => setDraft({ ...draft, vibe: e.target.value })} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {vibes.length > 0 ? vibes.map(v => (
                  <span key={v} className="text-xs px-2.5 py-1 rounded-sm" style={{ background: "#FFE1A1", border: "1px solid #0F0D0A" }}>{v}</span>
                )) : <span className="text-xs text-muted-foreground opacity-50">—</span>}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Tags</p>
            {editing ? (
              <input className="w-full rounded-sm px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                placeholder="design, tools, inspo..." value={tagsInput} onChange={e => setTagsInput(e.target.value)} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.length > 0 ? tags.map(t => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-sm" style={{ background: "#FFDEB3", border: "1px solid rgba(15,13,10,0.4)" }}>#{t}</span>
                )) : <span className="text-xs text-muted-foreground opacity-50">—</span>}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Your note</p>
            {editing ? (
              <input className="w-full rounded-sm px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                value={draft.user_note} onChange={e => setDraft({ ...draft, user_note: e.target.value })} />
            ) : (
              <p className="text-sm text-muted-foreground italic">{draft.user_note ? `"${draft.user_note}"` : "—"}</p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Saved</p>
            <p className="text-xs text-muted-foreground opacity-60">
              {new Date(link.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Visual Detail Panel ───────────────────────────────────────────────────

function VisualDetailPanel({ visual, moodboards, onClose, onSave }: {
  visual: SavedVisual
  moodboards: Moodboard[]
  onClose: () => void
  onSave: (updated: SavedVisual) => void
}) {
  const [note, setNote] = useState(visual.user_note || "")
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSaveNote() {
    setSaving(true)
    const { error } = await supabase.from("visuals").update({ user_note: note }).eq("id", visual.id)
    if (!error) { onSave({ ...visual, user_note: note }); setDirty(false) }
    setSaving(false)
  }

  const vibes = Array.isArray(visual.vibe) ? visual.vibe : []
  const tags = Array.isArray(visual.tags) ? visual.tags : []
  const moodboardName = moodboards.find(m => m.id === visual.moodboard_id)?.name

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex bg-black/20"
    >
      <div className="flex-1" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="w-full max-w-md flex flex-col relative"
      >
        <svg
          style={{ position: "absolute", left: 0, top: 0, width: 14, height: "100%", pointerEvents: "none", zIndex: 20 }}
        >
          <defs>
            <pattern id="notchBorderVisual" x="0" y="0" width="14" height="40" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 1 11 A 9 9 0 0 1 1 29 L 1 40" fill="none" stroke="#0F0D0A" strokeWidth="2" />
            </pattern>
          </defs>
          <rect width="14" height="100%" fill="url(#notchBorderVisual)" />
        </svg>

        <div
          className="flex flex-col overflow-y-auto flex-1"
          style={{ background: "#FCF9F5", clipPath: PANEL_NOTCH_CLIP }}
        >
          <div className="flex items-center justify-between px-6 py-4 sticky top-0 z-10" style={{ background: "#FCF9F5", borderBottom: "2px solid #0F0D0A" }}>
            <p className="text-xs font-medium opacity-50">Visual</p>
            <button onClick={onClose} className="opacity-40 hover:opacity-100 ml-1">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-hidden shrink-0" style={{ borderBottom: "2px solid #0F0D0A" }}>
            <img src={visual.public_url} alt={visual.title} className="w-full h-auto object-cover" />
          </div>

          <div className="px-6 py-6 space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Title</p>
              <p className="text-sm font-medium">{visual.title || "—"}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Description</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{visual.description || "—"}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Vibe</p>
              <div className="flex flex-wrap gap-1.5">
                {vibes.length > 0 ? vibes.map(v => (
                  <span key={v} className="text-xs px-2.5 py-1 rounded-sm" style={{ background: "#FFE1A1", border: "1px solid #0F0D0A" }}>{v}</span>
                )) : <span className="text-xs text-muted-foreground opacity-50">—</span>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.length > 0 ? tags.map(t => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-sm" style={{ background: "#FFDEB3", border: "1px solid rgba(15,13,10,0.4)" }}>#{t}</span>
                )) : <span className="text-xs text-muted-foreground opacity-50">—</span>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Your note</p>
              <input
                className="w-full rounded-sm px-3 py-2 text-sm"
                style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                placeholder="Add a note..."
                value={note}
                onChange={e => { setNote(e.target.value); setDirty(true) }}
                onBlur={() => { if (dirty) handleSaveNote() }}
              />
              {saving && <p className="text-xs text-muted-foreground opacity-50 mt-1">Saving...</p>}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Moodboard</p>
              <p className="text-sm">{moodboardName || "—"}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Saved</p>
              <p className="text-xs text-muted-foreground opacity-60">
                {new Date(visual.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Import View ───────────────────────────────────────────────────────────

function ImportView({ onImportDone, onCancel }: { onImportDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<"paste" | "review" | "processing" | "done">("paste")
  const [rawText, setRawText] = useState("")
  const [parsedLinks, setParsedLinks] = useState<ParsedLink[]>([])
  const [error, setError] = useState("")
  const [status, setStatus] = useState("")
  const [progress, setProgress] = useState(0)
  const [importedCount, setImportedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)

  function handleParse() {
    const urls = extractUrls(rawText)
    if (!urls.length) { setError("No URLs found. Make sure links start with http:// or https://"); return }
    setError("")
    setParsedLinks(urls.map(url => ({ url, note: "", platform: detectPlatform(url) })))
    setStep("review")
  }

  async function handleImport() {
    setStep("processing")
    setProgress(0)
    setError("")
    try {
      const { data: existing } = await supabase.from("links").select("url")
      const existingUrls = new Set((existing || []).map((l: { url: string }) => l.url))
      const newLinks = parsedLinks.filter(l => !existingUrls.has(l.url))
      setSkippedCount(parsedLinks.length - newLinks.length)

      if (!newLinks.length) { setImportedCount(0); setStep("done"); onImportDone(); return }

      const BATCH_SIZE = 10
      const batches = []
      for (let i = 0; i < newLinks.length; i += BATCH_SIZE) batches.push(newLinks.slice(i, i + BATCH_SIZE))

      const allResults: object[] = []
      for (let i = 0; i < batches.length; i++) {
        setStatus("Characterising your links...")
        setProgress(Math.round((i / batches.length) * 80))
        const response = await fetch(EDGE_FN_URL, {
          method: "POST",
          headers: await authHeader(),
          body: JSON.stringify({ links: batches[i] }),
        })
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || `Batch ${i + 1} failed`) }
        const { results: batchResults } = await response.json()
        allResults.push(...batchResults)
      }

      setProgress(85)
      setStatus("Saving...")
      const { error: dbError } = await supabase.from("links").insert(allResults)
      if (dbError) throw new Error(dbError.message)
      setImportedCount(allResults.length)

      setProgress(100)
      setStep("done")
      onImportDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setStep("review")
    }
  }

  const paperStyle = {
    background: "#FCF9F5",
    border: "2px solid #0F0D0A",
    boxShadow: "5px 5px 0 #0F0D0A",
  }

  if (step === "paste") return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <div className="rounded-sm p-8" style={paperStyle}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "'DM Serif Display', serif" }}>Drop your links</h2>
          <button onClick={onCancel} className="opacity-40 hover:opacity-100"><X size={18} /></button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Paste any text with links — URLs will be extracted automatically.</p>
        <textarea
          className="w-full h-44 rounded-sm p-4 text-sm resize-none focus:outline-none"
          style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
          placeholder={"https://x.com/someone/status/...\nhttps://some-tool.com\n\nOr paste a whole block of text with links in it."}
          value={rawText}
          onChange={e => setRawText(e.target.value)}
        />
        {error && <p className="text-destructive text-sm mt-2">{error}</p>}
        <button
          onClick={handleParse}
          disabled={!rawText.trim()}
          className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-sm text-sm font-semibold disabled:opacity-40"
          style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A" }}
        >
          Parse links <ArrowRight size={15} />
        </button>
      </div>
    </div>
  )

  if (step === "review") return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <div className="rounded-sm p-8" style={paperStyle}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold" style={{ fontFamily: "'DM Serif Display', serif" }}>Review {parsedLinks.length} links</h2>
          <button onClick={() => setStep("paste")} className="text-sm text-muted-foreground hover:text-foreground">← back</button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">Add a note for social links — helps Claude understand what they're about.</p>
        <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
          {parsedLinks.map((link, i) => (
            <div key={link.url} className="rounded-sm p-3" style={{ background: "#FFF8F0", border: "1.5px solid #0F0D0A" }}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs px-2 py-0.5 rounded-sm font-medium" style={{ background: "#FFE1A1", border: "1px solid #0F0D0A" }}>{link.platform}</span>
                  <span className="text-xs text-muted-foreground truncate opacity-60">{link.url}</span>
                </div>
                <button onClick={() => setParsedLinks(prev => prev.filter((_, idx) => idx !== i))} className="shrink-0 opacity-40 hover:opacity-100"><X size={13} /></button>
              </div>
              {isSocialPlatform(link.platform) && (
                <input type="text" placeholder="What is this about?"
                  value={link.note}
                  onChange={e => setParsedLinks(prev => prev.map((l, idx) => idx === i ? { ...l, note: e.target.value } : l))}
                  className="w-full text-xs rounded-sm px-3 py-1.5 focus:outline-none"
                  style={{ border: "1px solid rgba(15,13,10,0.3)", background: "#FCF9F5" }}
                />
              )}
            </div>
          ))}
        </div>
        {error && <p className="text-destructive text-sm mt-3">{error}</p>}
        <button
          onClick={handleImport}
          className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-sm text-sm font-semibold"
          style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A" }}
        >
          Characterise & save <ArrowRight size={15} />
        </button>
      </div>
    </div>
  )

  if (step === "processing") return (
    <div className="max-w-sm mx-auto py-24 px-4 text-center">
      <Loader2 size={28} className="animate-spin mx-auto mb-5 opacity-40" />
      <p className="text-sm font-medium mb-5">{status}</p>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#FFDEB3", border: "1px solid #0F0D0A" }}>
        <motion.div className="h-full rounded-full" style={{ background: "#0F0D0A" }} animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} />
      </div>
    </div>
  )

  return (
    <div className="max-w-sm mx-auto py-24 px-4 text-center">
      <div className="w-14 h-14 rounded-sm flex items-center justify-center mx-auto mb-5" style={{ background: "#FFE1A1", border: "2px solid #0F0D0A", boxShadow: "3px 3px 0 #0F0D0A" }}>
        <Check size={22} />
      </div>
      <p className="text-lg font-semibold mb-1" style={{ fontFamily: "'DM Serif Display', serif" }}>Done</p>
      <p className="text-sm text-muted-foreground mb-6">
        {importedCount} saved{skippedCount > 0 && `, ${skippedCount} duplicate${skippedCount !== 1 ? "s" : ""} skipped`}.
      </p>
      <button onClick={onImportDone} className="px-5 py-2.5 rounded-sm text-sm font-semibold" style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A" }}>
        Back to desk
      </button>
    </div>
  )
}

// ─── Search View ───────────────────────────────────────────────────────────

function SearchView({ links, visuals, thoughts, initialQuery, onLinkClick, onVisualClick, onThoughtClick, onClose }: {
  links: SavedLink[]
  visuals: SavedVisual[]
  thoughts: SavedThought[]
  initialQuery?: string
  onLinkClick: (l: SavedLink) => void
  onVisualClick: (v: SavedVisual) => void
  onThoughtClick: (t: SavedThought) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(initialQuery || "")
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)

      // Kick off semantic search fetch immediately
      const semanticPromise = fetch(SEARCH_FN_URL, {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({ query: query.trim() }),
      })

      // Run local keyword filter synchronously while fetch is in flight
      const q = query.toLowerCase()
      const words = q.split(" ").filter(Boolean)
      const keywordLinks: SearchResultItem[] = links.filter(link => {
        const haystack = [
          link.title, link.summary, link.vibe, link.category,
          link.user_note, link.description, link.platform,
          ...(Array.isArray(link.tags) ? link.tags : []),
        ].join(" ").toLowerCase()
        return words.every(word => haystack.includes(word))
      }).map(l => ({ ...l, type: "link" as const }))
      const keywordVisuals: SearchResultItem[] = visuals.filter(v => {
        const haystack = [
          v.title, v.description, v.user_note, v.category,
          ...(Array.isArray(v.vibe) ? v.vibe : []),
          ...(Array.isArray(v.tags) ? v.tags : []),
        ].join(" ").toLowerCase()
        return words.every(word => haystack.includes(word))
      }).map(v => ({ ...v, type: "visual" as const }))
      const keywordThoughts: SearchResultItem[] = thoughts.filter(t => {
        const haystack = t.content.toLowerCase()
        return words.every(word => haystack.includes(word))
      }).map(t => ({ ...t, type: "thought" as const }))
      const keywordResults: SearchResultItem[] = [...keywordLinks, ...keywordVisuals, ...keywordThoughts]

      try {
        const res = await semanticPromise
        if (!res.ok) throw new Error("Search failed")
        const { results: semanticHits } = await res.json()
        const hits: SearchResultItem[] = semanticHits ?? []

        // Merge: semantic first, append any keyword-only matches not already present
        const seen = new Set(hits.map(item => item.id))
        const combined = [...hits, ...keywordResults.filter(item => !seen.has(item.id))]
        setResults(combined)
      } catch (_) {
        // Semantic failed — fall back to keyword results only
        setResults(keywordResults)
      } finally {
        setSearching(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [query, links, visuals, thoughts])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: "#FFEADA" }}
    >
      <div className="px-8 pt-8 pb-4">
        <div className="relative max-w-2xl mx-auto">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
          <input
            autoFocus
            type="text"
            placeholder="Search by vibe, topic, feeling..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-11 pr-12 py-4 rounded-sm text-base focus:outline-none"
            style={{ border: "2px solid #0F0D0A", background: "#FCF9F5", fontFamily: "'Space Grotesk', sans-serif", boxShadow: "4px 4px 0 #0F0D0A" }}
          />
          <button onClick={onClose} className="absolute right-4 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {!query && (
          <div className="text-center py-20 opacity-30">
            <p className="text-sm">Type to search across titles, vibes, tags, summaries</p>
          </div>
        )}
        {query && searching && (
          <div className="text-center py-20">
            <Loader2 size={20} className="animate-spin mx-auto opacity-30" />
          </div>
        )}
        {query && !searching && results.length === 0 && (
          <div className="text-center py-20 opacity-40">
            <p className="text-sm">Nothing found for "{query}"</p>
          </div>
        )}
        {!searching && results.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground mb-5 opacity-60">{results.length} result{results.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 max-w-6xl mx-auto items-start">
              {results.map((item, i) => item.type === "visual" ? (
                <VisualCard key={item.id} visual={item} onClick={() => onVisualClick(item)} index={i} />
              ) : item.type === "thought" ? (
                <ThoughtSnippetCard key={item.id} thought={item} onClick={() => onThoughtClick(item)} index={i} />
              ) : (
                <PaperCard key={item.id} link={item} onClick={() => onLinkClick(item)} index={i} />
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ─── Category View ─────────────────────────────────────────────────────────

function CategoryView({ category, links, onBack, onCardClick }: {
  category: string
  links: SavedLink[]
  onBack: () => void
  onCardClick: (l: SavedLink) => void
}) {
  return (
    <motion.div
      key="category"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 overflow-y-auto"
    >
      <div className="px-8 py-6">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-sm"
            style={{ border: "1.5px solid #0F0D0A", background: "#FCF9F5", boxShadow: "2px 2px 0 #0F0D0A" }}
          >
            <ArrowLeft size={14} /> Desk
          </button>
          <div>
            <h2 className="text-2xl font-semibold" style={{ fontFamily: "'DM Serif Display', serif" }}>{category}</h2>
            <p className="text-xs text-muted-foreground opacity-60">{links.length} {links.length === 1 ? "link" : "links"}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {links.map((link, i) => (
            <PaperCard key={link.id} link={link} onClick={() => onCardClick(link)} index={i} />
          ))}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Visual Category Stack & View ──────────────────────────────────────────

function VisualCategoryStack({ category, visuals, paletteIndex, onClick }: {
  category: string
  visuals: SavedVisual[]
  paletteIndex: number
  onClick: () => void
}) {
  const palette = STACK_PALETTES[paletteIndex % STACK_PALETTES.length]
  const preview = visuals.slice(0, 4)

  return (
    <motion.div
      whileHover={{ y: -8, transition: { type: "spring", stiffness: 400, damping: 20 } }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className="cursor-pointer relative"
      style={{ width: 200, height: 240 }}
    >
      <div
        className="absolute inset-0 rounded-sm"
        style={{ background: palette.back, border: "2px solid #0F0D0A", transform: "rotate(-7deg) translate(-6px, 6px)", boxShadow: "3px 3px 0 #0F0D0A" }}
      />
      <div
        className="absolute inset-0 rounded-sm"
        style={{ background: palette.mid, border: "2px solid #0F0D0A", transform: "rotate(-3deg) translate(-2px, 3px)", boxShadow: "3px 3px 0 #0F0D0A" }}
      />
      <div
        className="absolute inset-0 rounded-sm flex flex-col p-5"
        style={{ background: palette.front, border: "2px solid #0F0D0A", transform: "rotate(1deg)", boxShadow: "4px 4px 0 #0F0D0A" }}
      >
        <div
          className="absolute rounded-full"
          style={{ width: 14, height: 14, background: "#F53535", border: "2px solid #0F0D0A", top: 14, right: 18, boxShadow: "1px 1px 0 #0F0D0A" }}
        />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {visuals.length} {visuals.length === 1 ? "image" : "images"}
        </p>
        <h3 className="font-semibold leading-tight text-foreground flex-1" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.05rem" }}>
          {category}
        </h3>
        {preview.length > 0 && (
          <div className="flex gap-1 mt-3">
            {preview.map(v => (
              <div key={v.id} className="w-8 h-8 rounded-sm overflow-hidden shrink-0" style={{ border: "1px solid #0F0D0A" }}>
                <img src={v.public_url} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function VisualCategoryView({ category, visuals, onBack, onCardClick }: {
  category: string
  visuals: SavedVisual[]
  onBack: () => void
  onCardClick: (v: SavedVisual) => void
}) {
  return (
    <motion.div
      key="visual-category"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 overflow-y-auto"
    >
      <div className="px-8 py-6">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-sm"
            style={{ border: "1.5px solid #0F0D0A", background: "#FCF9F5", boxShadow: "2px 2px 0 #0F0D0A" }}
          >
            <ArrowLeft size={14} /> Categories
          </button>
          <div>
            <h2 className="text-2xl font-semibold" style={{ fontFamily: "'DM Serif Display', serif" }}>{category}</h2>
            <p className="text-xs text-muted-foreground opacity-60">{visuals.length} {visuals.length === 1 ? "image" : "images"}</p>
          </div>
        </div>
        <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4">
          {visuals.map((visual, i) => (
            <VisualCard key={visual.id} visual={visual} onClick={() => onCardClick(visual)} index={i} />
          ))}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Visual Board View ──────────────────────────────────────────────────────

function VisualBoardView({ visuals, onCardClick, onUploaded, visualView, onSetVisualView, activeVisualCategory, onCategoryClick, onBackFromCategory, onRecluster, reclustering }: {
  visuals: SavedVisual[]
  onCardClick: (v: SavedVisual) => void
  onUploaded: (v: SavedVisual) => void
  visualView: "all" | "categories" | "categoryDetail"
  onSetVisualView: (v: "all" | "categories") => void
  activeVisualCategory: string | null
  onCategoryClick: (category: string) => void
  onBackFromCategory: () => void
  onRecluster: () => void
  reclustering: boolean
}) {
  const grouped = useMemo(() => {
    const map: Record<string, SavedVisual[]> = {}
    for (const v of visuals) {
      const cat = v.category || "Uncategorised"
      if (!map[cat]) map[cat] = []
      map[cat].push(v)
    }
    return map
  }, [visuals])
  const categories = Object.keys(grouped).sort()

  if (visualView === "categoryDetail" && activeVisualCategory) {
    return (
      <VisualCategoryView
        category={activeVisualCategory}
        visuals={grouped[activeVisualCategory] || []}
        onBack={onBackFromCategory}
        onCardClick={onCardClick}
      />
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <VisualUploadZone onUploaded={onUploaded} />

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1 rounded-sm p-1" style={{ border: "1.5px solid rgba(15,13,10,0.2)" }}>
          <button
            onClick={() => onSetVisualView("all")}
            className="px-3 py-1.5 rounded-sm text-xs font-medium transition-colors"
            style={visualView === "all" ? { background: "#0F0D0A", color: "#FFEADA" } : { color: "#6B5B4A" }}
          >
            All images
          </button>
          <button
            onClick={() => onSetVisualView("categories")}
            className="px-3 py-1.5 rounded-sm text-xs font-medium transition-colors"
            style={visualView === "categories" ? { background: "#0F0D0A", color: "#FFEADA" } : { color: "#6B5B4A" }}
          >
            Categories
          </button>
        </div>
        {visualView === "categories" && (
          <button
            onClick={onRecluster}
            disabled={reclustering || visuals.length < 5}
            className="flex items-center gap-1.5 text-xs opacity-40 hover:opacity-80 disabled:opacity-20 transition-opacity"
          >
            <RefreshCw size={11} className={reclustering ? "animate-spin" : ""} />
            {reclustering ? "Reorganising..." : "Reorganise categories"}
          </button>
        )}
      </div>

      {!visuals.length ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground opacity-60">Your visual board is empty — drop some images above to get started</p>
        </div>
      ) : visualView === "all" ? (
        <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4">
          {visuals.map((visual, i) => (
            <VisualCard key={visual.id} visual={visual} onClick={() => onCardClick(visual)} index={i} />
          ))}
        </div>
      ) : (
        <motion.div
          className="flex flex-wrap gap-10"
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
        >
          {categories.map((cat, i) => (
            <motion.div
              key={cat}
              variants={{ hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 280, damping: 22 } } }}
            >
              <VisualCategoryStack category={cat} visuals={grouped[cat]} paletteIndex={i} onClick={() => onCategoryClick(cat)} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  )
}

// ─── Landing View ──────────────────────────────────────────────────────────

function LandingView({ links, onCategoryClick, onRecluster, reclustering }: {
  links: SavedLink[]
  onCategoryClick: (category: string) => void
  onRecluster: () => void
  reclustering: boolean
}) {
  const grouped = useMemo(() => {
    const map: Record<string, SavedLink[]> = {}
    for (const link of links) {
      const cat = link.category || "Other"
      if (!map[cat]) map[cat] = []
      map[cat].push(link)
    }
    return map
  }, [links])

  const categories = Object.keys(grouped).sort()

  if (!links.length) return (
    <div className="flex-1 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        {/* Empty desk illustration */}
        <div className="relative mx-auto mb-6" style={{ width: 160, height: 180 }}>
          <div className="absolute inset-0 rounded-sm" style={{ background: "#FFDEB3", border: "2px solid #0F0D0A", transform: "rotate(-6deg)", boxShadow: "3px 3px 0 #0F0D0A" }} />
          <div className="absolute inset-0 rounded-sm" style={{ background: "#FCF9F5", border: "2px solid #0F0D0A", transform: "rotate(-1deg)", boxShadow: "3px 3px 0 #0F0D0A" }} />
          <div className="absolute inset-0 rounded-sm flex items-center justify-center" style={{ background: "#FFFFFF", border: "2px solid #0F0D0A", boxShadow: "4px 4px 0 #0F0D0A" }}>
            <Plus size={28} className="opacity-20" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground opacity-60">Your desk is empty — add some links to get started</p>
      </motion.div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <p className="text-xs text-muted-foreground opacity-50">{links.length} links across {categories.length} {categories.length === 1 ? "pile" : "piles"}</p>
        <button
          onClick={onRecluster}
          disabled={reclustering || links.length < 5}
          className="flex items-center gap-1.5 text-xs opacity-40 hover:opacity-80 disabled:opacity-20 transition-opacity"
        >
          <RefreshCw size={11} className={reclustering ? "animate-spin" : ""} />
          {reclustering ? "Reorganising..." : "Reorganise categories"}
        </button>
      </div>
      <motion.div
        className="flex flex-wrap gap-10"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
      >
        {categories.map((cat, i) => (
          <motion.div
            key={cat}
            variants={{ hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 280, damping: 22 } } }}
          >
            <CategoryStack
              category={cat}
              links={grouped[cat]}
              paletteIndex={i}
              onClick={() => onCategoryClick(cat)}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}

// ─── Login View ────────────────────────────────────────────────────────────

function LoginView() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    if (email !== import.meta.env.VITE_ALLOWED_EMAIL) {
      setDenied(true)
      return
    }
    setLoading(true)
    await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFEADA", fontFamily: "'Space Grotesk', sans-serif" }}>
      <div className="w-full max-w-sm px-8 py-10" style={{ background: "#FCF9F5", border: "2px solid #0F0D0A", boxShadow: "4px 4px 0 #0F0D0A" }}>
        <p className="text-2xl font-semibold mb-1" style={{ fontFamily: "'DM Serif Display', serif" }}>linkdesk</p>
        <p className="text-sm opacity-50 mb-8">Your personal link desk.</p>
        {sent ? (
          <p className="text-sm">Check your email — a magic link is on its way.</p>
        ) : denied ? (
          <p className="text-sm">You don't have access to this.</p>
        ) : (
          <form onSubmit={handleSend} className="flex flex-col gap-3">
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required
              className="px-3 py-2.5 text-sm w-full outline-none"
              style={{ border: "2px solid #0F0D0A", background: "#FFEADA", fontFamily: "'Space Grotesk', sans-serif" }}
            />
            <button type="submit" disabled={loading}
              className="px-4 py-2.5 text-sm font-semibold"
              style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A", boxShadow: "2px 2px 0 rgba(15,13,10,0.3)" }}
            >
              {loading ? "Sending..." : "Send magic link"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<unknown>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [links, setLinks] = useState<SavedLink[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"desk" | "category" | "import">("desk")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedLink, setSelectedLink] = useState<SavedLink | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [reclustering, setReclustering] = useState(false)

  const [board, setBoard] = useState<"desk" | "visual" | "thoughts">("desk")
  const [visuals, setVisuals] = useState<SavedVisual[]>([])
  const [visualsLoading, setVisualsLoading] = useState(true)
  const [moodboards, setMoodboards] = useState<Moodboard[]>([])
  const [visualView, setVisualView] = useState<"all" | "categories" | "categoryDetail">("all")
  const [activeVisualCategory, setActiveVisualCategory] = useState<string | null>(null)
  const [selectedVisual, setSelectedVisual] = useState<SavedVisual | null>(null)
  const [visualReclustering, setVisualReclustering] = useState(false)

  const [thoughts, setThoughts] = useState<SavedThought[]>([])
  const [thoughtsLoading, setThoughtsLoading] = useState(true)
  const [searchInitialQuery, setSearchInitialQuery] = useState("")

  const categories = useMemo(() => [...new Set(links.map(l => l.category).filter(Boolean))].sort(), [links])

  async function fetchLinks() {
    const { data, error } = await supabase.from("links").select("*").order("created_at", { ascending: false })
    if (!error && data) setLinks(data)
    setLoading(false)
  }

  async function fetchVisuals() {
    const { data, error } = await supabase.from("visuals").select("*").order("created_at", { ascending: false })
    if (!error && data) setVisuals(data)
    setVisualsLoading(false)
  }

  async function fetchMoodboards() {
    const { data, error } = await supabase.from("moodboards").select("id, name")
    if (!error && data) setMoodboards(data)
  }

  async function fetchThoughts() {
    const { data, error } = await supabase.from("thoughts").select("id, content, created_at").order("created_at", { ascending: false })
    if (!error && data) setThoughts(data)
    setThoughtsLoading(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => { fetchLinks() }, [])
  useEffect(() => { fetchVisuals(); fetchMoodboards() }, [])
  useEffect(() => { fetchThoughts() }, [])

  function handleVisualUploaded(visual: SavedVisual) {
    setVisuals(prev => [visual, ...prev])
  }

  function handleThoughtSaved(thought: SavedThought) {
    setThoughts(prev => [thought, ...prev])
  }

  function openSearchWithQuery(q: string) {
    setSearchInitialQuery(q)
    setShowSearch(true)
  }

  async function handleRecluster() {
    if (links.length < 5) return
    setReclustering(true)
    try {
      const payload = links.map(l => ({ id: l.id, url: l.url, title: l.title, summary: l.summary, tags: l.tags, user_note: l.user_note }))
      const res = await fetch(CLUSTER_FN_URL, {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({ links: payload }),
      })
      if (res.ok) {
        const { assignments } = await res.json()
        if (assignments?.length) {
          await Promise.all(assignments.map((a: { id: string; category: string }) =>
            supabase.from("links").update({ category: a.category }).eq("id", a.id)
          ))
          await fetchLinks()
        }
      }
    } catch (_) {}
    setReclustering(false)
  }

  async function handleReclusterVisuals() {
    if (visuals.length < 5) return
    setVisualReclustering(true)
    try {
      const res = await fetch(CLUSTER_VISUALS_FN_URL, {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({}),
      })
      if (res.ok) await fetchVisuals()
    } catch (_) {}
    setVisualReclustering(false)
  }

  function handleImportDone() {
    fetchLinks()
    setView("desk")
  }

  const categoryLinks = useMemo(() => {
    if (!activeCategory) return []
    return links.filter(l => l.category === activeCategory)
  }, [links, activeCategory])

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFEADA" }}>
      <Loader2 size={24} className="animate-spin opacity-30" />
    </div>
  )
  if (!session) return <LoginView />

  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: "'Space Grotesk', sans-serif", background: "#FFEADA" }}>
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between shrink-0" style={{ borderBottom: "2px solid rgba(15,13,10,0.12)" }}>
        <div className="flex items-center gap-5">
          <button
            onClick={() => { setBoard("desk"); setView("desk"); setActiveCategory(null) }}
            className="text-xl font-semibold tracking-tight"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            linkdesk
          </button>
          <div className="flex items-center gap-1 rounded-sm p-1" style={{ border: "1.5px solid rgba(15,13,10,0.2)" }}>
            <button
              onClick={() => setBoard("desk")}
              className="px-3 py-1.5 rounded-sm text-sm font-medium transition-colors"
              style={board === "desk" ? { background: "#0F0D0A", color: "#FFEADA" } : { color: "#6B5B4A" }}
            >
              Desk
            </button>
            <button
              onClick={() => setBoard("visual")}
              className="px-3 py-1.5 rounded-sm text-sm font-medium transition-colors"
              style={board === "visual" ? { background: "#0F0D0A", color: "#FFEADA" } : { color: "#6B5B4A" }}
            >
              Visual Board
            </button>
            <button
              onClick={() => setBoard("thoughts")}
              className="px-3 py-1.5 rounded-sm text-sm font-medium transition-colors"
              style={board === "thoughts" ? { background: "#0F0D0A", color: "#FFEADA" } : { color: "#6B5B4A" }}
            >
              Thoughts
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSearchInitialQuery(""); setShowSearch(true) }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-sm font-medium"
            style={{ border: "1.5px solid rgba(15,13,10,0.25)", background: "transparent" }}
          >
            <Search size={14} className="opacity-60" /> Search
          </button>
          {board === "desk" && (
            <button
              onClick={() => setView("import")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-sm font-semibold"
              style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A", boxShadow: "2px 2px 0 rgba(15,13,10,0.3)" }}
            >
              <Plus size={14} /> Add links
            </button>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs opacity-30 hover:opacity-60 transition-opacity px-2 py-2"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {board === "visual" ? (
          visualsLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin opacity-30" />
            </div>
          ) : (
            <VisualBoardView
              visuals={visuals}
              onCardClick={visual => setSelectedVisual(visual)}
              onUploaded={handleVisualUploaded}
              visualView={visualView}
              onSetVisualView={setVisualView}
              activeVisualCategory={activeVisualCategory}
              onCategoryClick={cat => { setActiveVisualCategory(cat); setVisualView("categoryDetail") }}
              onBackFromCategory={() => { setVisualView("categories"); setActiveVisualCategory(null) }}
              onRecluster={handleReclusterVisuals}
              reclustering={visualReclustering}
            />
          )
        ) : board === "thoughts" ? (
          thoughtsLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin opacity-30" />
            </div>
          ) : (
            <ThoughtsView
              thoughts={thoughts}
              links={links}
              visuals={visuals}
              onSaved={handleThoughtSaved}
              onLinkClick={link => setSelectedLink(link)}
              onVisualClick={visual => setSelectedVisual(visual)}
              onTagClick={tag => openSearchWithQuery(tag)}
              onCategoryClick={cat => openSearchWithQuery(cat)}
            />
          )
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin opacity-30" />
          </div>
        ) : view === "import" ? (
          <div className="flex-1 overflow-y-auto">
            <ImportView onImportDone={handleImportDone} onCancel={() => setView("desk")} />
          </div>
        ) : view === "category" && activeCategory ? (
          <CategoryView
            category={activeCategory}
            links={categoryLinks}
            onBack={() => { setView("desk"); setActiveCategory(null) }}
            onCardClick={link => {
              setActiveCategory(link.category)
              setView("category")
              setSelectedLink(link)
            }}
          />
        ) : (
          <LandingView
            links={links}
            onCategoryClick={cat => { setActiveCategory(cat); setView("category") }}
            onRecluster={handleRecluster}
            reclustering={reclustering}
          />
        )}
      </div>

      {/* Search overlay */}
      <AnimatePresence>
        {showSearch && (
          <SearchView
            links={links}
            visuals={visuals}
            thoughts={thoughts}
            initialQuery={searchInitialQuery}
            onLinkClick={link => setSelectedLink(link)}
            onVisualClick={visual => setSelectedVisual(visual)}
            onThoughtClick={() => { setShowSearch(false); setBoard("thoughts") }}
            onClose={() => setShowSearch(false)}
          />
        )}
      </AnimatePresence>

      {/* Detail panel */}
      <AnimatePresence>
        {selectedLink && (
          <LinkDetailPanel
            link={selectedLink}
            categories={categories}
            onClose={() => setSelectedLink(null)}
            onSave={updated => {
              setLinks(prev => prev.map(l => l.id === updated.id ? updated : l))
              setSelectedLink(updated)
            }}
            onDelete={id => {
              setLinks(prev => prev.filter(l => l.id !== id))
              setSelectedLink(null)
            }}
          />
        )}
      </AnimatePresence>

      {/* Visual detail panel */}
      <AnimatePresence>
        {selectedVisual && (
          <VisualDetailPanel
            visual={selectedVisual}
            moodboards={moodboards}
            onClose={() => setSelectedVisual(null)}
            onSave={updated => {
              setVisuals(prev => prev.map(v => v.id === updated.id ? updated : v))
              setSelectedVisual(updated)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
