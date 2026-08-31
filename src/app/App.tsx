import React, { useState, useEffect, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { createClient } from "@supabase/supabase-js"
import { Search, Plus, ExternalLink, Loader2, X, ArrowRight, ArrowLeft, Pencil, Check, Trash2, RefreshCw, Upload } from "lucide-react"
import Masonry, { ResponsiveMasonry } from "react-responsive-masonry"
import "./folderTabs.css"

// ─── Folder tab strip — copied from src/assets/tabs_ui.html (drawStrip) ────
const TAB_COLORS: Record<"links" | "images" | "thoughts", string> = { links: "#FF7D4E", images: "#54B5DF", thoughts: "#96C434" }

function drawStrip(activeId: string) {
  const activeTab = document.getElementById("tab-" + activeId)
  const wrap = document.getElementById("strip-wrap")
  const svg = document.getElementById("strip-svg")
  if (!activeTab || !wrap || !svg) return
  const color = TAB_COLORS[activeId as "links" | "images" | "thoughts"]

  const wrapRect = wrap.getBoundingClientRect()
  const tabRect = activeTab.getBoundingClientRect()
  const W = Math.round(wrapRect.width)
  const H = 12
  const SW = 2.5

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`)

  const gapL = Math.max(0, tabRect.left - wrapRect.left)
  const gapR = Math.min(W, tabRect.right - wrapRect.left)

  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" fill="${color}"/>
    <line x1="0"       y1="${SW / 2}" x2="${gapL}" y2="${SW / 2}" stroke="#1A1008" stroke-width="${SW}"/>
    <line x1="${gapR}" y1="${SW / 2}" x2="${W}"     y2="${SW / 2}" stroke="#1A1008" stroke-width="${SW}"/>
    <line x1="${SW / 2}" y1="0"       x2="${SW / 2}"  y2="${H}"    stroke="#1A1008" stroke-width="${SW}"/>
    <line x1="${W - SW / 2}" y1="0"     x2="${W - SW / 2}" y2="${H}"   stroke="#1A1008" stroke-width="${SW}"/>
  `
}

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
  title: string | null
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

// Category stacks read as tossed-down piles of paper, so they get a wider,
// more visible tilt than individual cards. A multiplicative hash (rather than
// a plain char-code sum) spreads out better so similarly-named categories
// don't end up with near-identical angles.
function getStackTilt(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  h = Math.abs(h)
  return ((h % 71) - 35) / 10
}

function getThoughtRotation(seed: string): number {
  const h = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return ((h % 21) - 10) / 20
}

// Maps a value proportionally from [inMin, inMax] onto [outMin, outMax].
// Used to scale a category stack's thickness/stagger relative to the
// smallest and largest categories in the current collection, rather than
// fixed thresholds — see CategoryStack (shared by both Links and Images).
function mapRange(val: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return (outMin + outMax) / 2
  return outMin + ((val - inMin) / (inMax - inMin)) * (outMax - outMin)
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

// Inverse of serializeThoughtContent — rebuilds the contentEditable DOM (text
// nodes + mention spans) from a stored "[[type:value]]" string, so opening a
// saved thought for editing looks and behaves exactly like one just typed.
function hydrateThoughtContent(root: HTMLElement, content: string) {
  root.innerHTML = ""
  const regex = new RegExp(MENTION_REGEX.source, "g")
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) root.appendChild(document.createTextNode(content.slice(lastIndex, match.index)))
    const type = match[1] as MentionType
    const value = match[2]
    const label = type === "tag" ? `#${value}` : value

    const span = document.createElement("span")
    span.textContent = label
    span.contentEditable = "false"
    span.dataset.mentionType = type
    span.dataset.mentionValue = value
    span.style.fontStyle = "italic"
    span.style.textDecoration = "underline"
    span.style.textDecorationColor = MENTION_COLORS[type]
    span.style.textUnderlineOffset = "2px"
    root.appendChild(span)

    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) root.appendChild(document.createTextNode(content.slice(lastIndex)))
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

// The card's actual visual design, split out from PaperCard so it can be
// reused as the front sheet of a category stack (see CategoryStack) without
// dragging along PaperCard's own click/hover/entrance behaviour.
function PaperCardContent({ link }: { link: SavedLink }) {
  const vibes = link.vibe ? link.vibe.split(",").map(v => v.trim()).filter(Boolean) : []
  const tags = Array.isArray(link.tags) ? link.tags : []

  return (
    <div
      className="bg-card rounded-lg overflow-hidden flex flex-col h-full"
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
          {link.url && (
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="shrink-0 mt-0.5 opacity-50 hover:opacity-100"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        {link.summary && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{link.summary}</p>
        )}
        {(vibes.length > 0 || tags.length > 0) && (
          <div className="flex flex-wrap gap-1 pt-1 mt-auto">
            {vibes.slice(0, 2).map(v => (
              <span key={v} className="text-xs px-2 py-0.5 rounded-lg bg-accent" style={{ border: "1px solid #0F0D0A" }}>{v}</span>
            ))}
            {tags.slice(0, 2).map(t => (
              <span key={t} className="text-xs px-2 py-0.5 rounded-lg bg-muted opacity-70">#{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PaperCard({ link, onClick, index }: { link: SavedLink; onClick: () => void; index: number }) {
  const rotation = getCardRotation(link.id)

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
      <PaperCardContent link={link} />
    </motion.div>
  )
}

// ─── Visual Card (individual image) ────────────────────────────────────────

// Same split as PaperCardContent — the polaroid's visual design, split out
// from VisualCard's click/hover/entrance behaviour.
function VisualCardContent({ visual }: { visual: SavedVisual }) {
  const vibes = Array.isArray(visual.vibe) ? visual.vibe : []

  return (
    <div
      className="rounded-lg overflow-hidden h-full flex flex-col"
      style={{ background: "#FEFCF6", border: "2px solid #0F0D0A", boxShadow: "4px 4px 0 #0F0D0A", padding: "10px 10px 14px" }}
    >
      <div className="overflow-hidden bg-muted shrink-0" style={{ border: "1px solid rgba(15,13,10,0.15)" }}>
        <img
          src={visual.public_url}
          alt={visual.title}
          className="w-full h-auto object-cover block"
          onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none" }}
        />
      </div>
      <div className="pt-3 flex flex-col gap-1.5 items-center text-center overflow-hidden">
        <p className="text-sm font-semibold leading-snug line-clamp-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {visual.title || "Untitled"}
        </p>
        {vibes.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-center">
            {vibes.slice(0, 3).map(v => (
              <span key={v} className="text-xs px-2 py-0.5 rounded-lg bg-accent" style={{ border: "1px solid #0F0D0A" }}>{v}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function VisualCard({ visual, onClick, index, layoutClassName = "cursor-pointer break-inside-avoid mb-4 inline-block w-full" }: {
  visual: SavedVisual
  onClick: () => void
  index: number
  // masonry-layout classes some call sites need (CSS `columns`) and others
  // don't (react-responsive-masonry, a real CSS grid) — override to "cursor-pointer"
  // wherever the parent already handles spacing, so gaps don't double up
  layoutClassName?: string
}) {
  const rotation = getCardRotation(visual.id)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, rotate: rotation - 3 }}
      animate={{ opacity: 1, y: 0, rotate: rotation, transition: { delay: index * 0.03, type: "spring", stiffness: 300, damping: 24 } }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -6, rotate: 0, transition: { type: "spring", stiffness: 400, damping: 20 } }}
      onClick={onClick}
      className={layoutClassName}
      style={{ transformOrigin: "center bottom" }}
    >
      <VisualCardContent visual={visual} />
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
        className="cursor-pointer rounded-lg flex flex-col items-center justify-center gap-2 py-10 px-6 text-center transition-colors"
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
              className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg"
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

// ─── Image Upload Panel ─────────────────────────────────────────────────────
// The exact same slide-in-drawer shell as LinkDetailPanel/VisualDetailPanel —
// same notched left edge, same backdrop/spring-in behaviour — just holding
// the upload zone instead of a link's fields.

function ImageUploadPanel({ onClose, onUploaded }: {
  onClose: () => void
  onUploaded: (visual: SavedVisual) => void
}) {
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
            <pattern id="notchBorderImageUpload" x="0" y="0" width="14" height="40" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 1 11 A 9 9 0 0 1 1 29 L 1 40" fill="none" stroke="#0F0D0A" strokeWidth="2" />
            </pattern>
          </defs>
          <rect width="14" height="100%" fill="url(#notchBorderImageUpload)" />
        </svg>

        {/* panel: clip-path cuts everything inside to the notched shape — no child background can overpaint the holes */}
        <div
          className="flex flex-col overflow-y-auto flex-1"
          style={{ background: "#FCF9F5", clipPath: PANEL_NOTCH_CLIP }}
        >
          <div className="flex items-center justify-between px-6 py-4 sticky top-0 z-10" style={{ background: "#FCF9F5", borderBottom: "2px solid #0F0D0A" }}>
            <h2 className="text-xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Add images</h2>
            <button onClick={onClose} className="opacity-40 hover:opacity-100">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-6">
            <p className="text-sm text-muted-foreground mb-4">Drop images here, or click to select — each one is characterised and categorised automatically.</p>
            <VisualUploadZone onUploaded={onUploaded} />
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Thought Page (torn notebook page shell) ───────────────────────────────

function ThoughtPage({ children, rotation = 0, className = "", onClick }: {
  children: React.ReactNode
  rotation?: number
  className?: string
  onClick?: () => void
}) {
  return (
    <div className={`thought-page ${className}`} style={{ transform: `rotate(${rotation}deg)` }} onClick={onClick}>
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
      className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg"
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
              {v.public_url && <img src={v.public_url} alt="" className="w-5 h-5 rounded-lg object-cover shrink-0" />}
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

// ─── Thought Composer — "New Post" immersive writing scene ────────────────
// This is the only way to write a new thought (the old inline compose box on
// the Thoughts page was removed in favour of this). It reuses the same
// mention encoding (getMentionQueryAtCaret/insertMention/serializeThoughtContent
// from the "Thought mention helpers" section above) so @ mentions, search, and
// rendering on saved thoughts all behave exactly as they did before.
// Ported from thought_writing.html: the room dims, a clipboard + lamp + desk
// widgets slide together in the dark, then a tug on the cord clicks the lamp
// on. Reversed on the way out. See src/styles/thoughtComposer.css.

function ThoughtComposerClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10000)
    return () => clearInterval(id)
  }, [])
  const hh = String(now.getHours()).padStart(2, "0")
  const mm = String(now.getMinutes()).padStart(2, "0")
  return (
    <div className="tc-clock">
      <svg width="145" height="55" viewBox="0 0 145 55" style={{ position: "absolute", inset: 0 }}>
        <rect x="1" y="1" width="143" height="53" rx="17" fill="#1B3043" stroke="black" strokeWidth="2" />
      </svg>
      <div className="tc-face">
        <span>{hh}</span><span className="tc-colon">:</span><span>{mm}</span>
      </div>
    </div>
  )
}

const LAMP_PALETTE = [
  { sw: "#F2BD78", from: "#FF7D4E", fromOp: 0.25, to: "#994B2F", off: 0.716346 },
  { sw: "#FFBCCA", from: "#BE80FF", fromOp: 0.22, to: "#A44EFF", off: 0.528407 },
  { sw: "#CFA2FF", from: "#A44EFF", fromOp: 1.0, to: "#8E2AF9", off: 0.570997 },
  { sw: "#B4F250", from: "#96C434", fromOp: 1.0, to: "#43A9D5", off: 0.653846 },
  { sw: "#FFC132", from: "#FF7D4E", fromOp: 0.25, to: "#994B2F", off: 0.855769 },
]

function ThoughtComposerScene({ thought, links, visuals, onSaved, onDeleted, onClose }: {
  thought?: SavedThought | null
  links: SavedLink[]
  visuals: SavedVisual[]
  onSaved: (thought: SavedThought) => void
  onDeleted?: (id: string) => void
  onClose: () => void
}) {
  const isEditing = !!thought
  const canvasRef = useRef<HTMLDivElement>(null)
  const composeRef = useRef<HTMLDivElement>(null)
  const rulesRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<SVGRectElement>(null)
  const knobRef = useRef<SVGCircleElement>(null)
  const stop1Ref = useRef<SVGStopElement>(null)
  const stop2Ref = useRef<SVGStopElement>(null)
  const scaleRef = useRef(1)
  const idxRef = useRef(0)
  const closingRef = useRef(false)
  const escapeHandlerRef = useRef<() => void>(() => {})

  const [title, setTitle] = useState(thought?.title || "")
  const [wordCount, setWordCount] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionRect, setMentionRect] = useState<{ left: number; top: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [error, setError] = useState("")
  const [entered, setEntered] = useState(false)
  const [lit, setLit] = useState(false)

  const reduce = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, [])
  const dateLabel = useMemo(() => new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }), [])

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

  function applyColour() {
    const p = LAMP_PALETTE[idxRef.current]
    rectRef.current?.setAttribute("fill", p.sw)
    knobRef.current?.setAttribute("fill", p.sw)
    stop1Ref.current?.setAttribute("stop-color", p.from)
    stop1Ref.current?.setAttribute("stop-opacity", String(p.fromOp))
    stop2Ref.current?.setAttribute("stop-color", p.to)
    stop2Ref.current?.setAttribute("offset", String(p.off))
  }

  function setPull(dragY: number, animate: boolean) {
    const rect = rectRef.current, knob = knobRef.current
    if (!rect || !knob) return
    rect.style.transition = animate ? "height .4s ease" : "none"
    knob.style.transition = animate ? "cy .4s ease" : "none"
    rect.setAttribute("height", String(320 + dragY))
    knob.setAttribute("cy", String(314 + dragY))
  }

  function autoPullOn() {
    setPull(44, true)
    setTimeout(() => { setLit(true); setPull(0, true) }, 420)
  }

  function autoPullOff(done: () => void) {
    setPull(44, true)
    setTimeout(() => {
      setLit(false)
      setPull(0, true)
      setTimeout(done, 380)
    }, 420)
  }

  function requestClose(skipConfirm = false) {
    if (closingRef.current) return
    const hasChanges = isEditing
      ? dirty
      : !!(composeRef.current?.textContent || "").trim() || !!title.trim()
    if (!skipConfirm && hasChanges) { setConfirmingClose(true); return }
    closingRef.current = true
    if (reduce || isEditing) { onClose(); return }
    autoPullOff(onClose)
  }

  function handleEscapeKey() {
    if (confirmingClose) { setConfirmingClose(false); return }
    if (mentionQuery !== null) { setMentionQuery(null); setMentionRect(null); return }
    requestClose()
  }
  // keeps the window-level Escape listener (registered once, below) calling
  // into whichever render's closure actually has the current title/dirty/
  // confirmingClose/mentionQuery — otherwise it'd be stuck reading mount-time values
  useEffect(() => { escapeHandlerRef.current = handleEscapeKey })

  async function handleSave() {
    if (!composeRef.current || saving) return
    const trimmed = serializeThoughtContent(composeRef.current).trim()
    if (!trimmed) return
    setSaving(true)
    setError("")

    if (isEditing && thought) {
      const updatedTitle = title.trim() || null
      const { error: dbError } = await supabase.from("thoughts").update({ title: updatedTitle, content: trimmed }).eq("id", thought.id)
      if (dbError) {
        setError("Couldn't save — try again")
        setSaving(false)
        return
      }
      onSaved({ ...thought, title: updatedTitle, content: trimmed })
      closingRef.current = true
      onClose()
      return
    }

    try {
      const response = await fetch(SAVE_THOUGHT_URL, {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({ content: trimmed, title: title.trim() || null }),
      })
      if (!response.ok) throw new Error("Failed to save")
      const { thought: saved } = await response.json()
      if (saved) {
        onSaved(saved)
        closingRef.current = true
        if (reduce) { onClose(); return }
        autoPullOff(onClose)
        return
      }
    } catch (_) {
      setError("Couldn't save — try again")
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!thought || deleting) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    const { error: dbError } = await supabase.from("thoughts").delete().eq("id", thought.id)
    if (dbError) { setDeleting(false); return }
    onDeleted?.(thought.id)
    closingRef.current = true
    onClose()
  }

  useEffect(() => {
    function fit() {
      if (!canvasRef.current) return
      const s = Math.min(window.innerWidth / 1280, window.innerHeight / 832)
      scaleRef.current = s
      canvasRef.current.style.transform = `scale(${s})`
    }
    fit()
    window.addEventListener("resize", fit)
    applyColour()

    // opening a saved thought: hydrate its content into the writer and skip
    // straight to "lit" — same clipboard/lamp/desk scene, just without the
    // dark-room-then-lamp-turns-on entrance performance
    if (thought && composeRef.current) {
      hydrateThoughtContent(composeRef.current, thought.content)
      const t = (composeRef.current.textContent || "").trim()
      setWordCount(t ? t.split(/\s+/).length : 0)
    }

    setEntered(true)
    let onTimer: ReturnType<typeof setTimeout> | undefined
    let focusTimer: ReturnType<typeof setTimeout> | undefined
    if (isEditing) {
      // viewing/editing an existing thought — no need to grab the cursor,
      // the user is here to read first
      setLit(true)
    } else if (reduce) {
      setLit(true)
      focusTimer = setTimeout(() => composeRef.current?.focus(), 50)
    } else {
      const ASSEMBLE_MS = 1250
      onTimer = setTimeout(autoPullOn, ASSEMBLE_MS)
      focusTimer = setTimeout(() => composeRef.current?.focus(), ASSEMBLE_MS + 1150)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") escapeHandlerRef.current()
    }
    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("resize", fit)
      window.removeEventListener("keydown", onKeyDown)
      if (onTimer) clearTimeout(onTimer)
      if (focusTimer) clearTimeout(focusTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function syncRules() {
    if (!rulesRef.current || !composeRef.current) return
    rulesRef.current.style.backgroundPositionY = `${-composeRef.current.scrollTop}px`
  }

  function handleComposeInput() {
    if (!composeRef.current) return
    const t = (composeRef.current.textContent || "").trim()
    setWordCount(t ? t.split(/\s+/).length : 0)
    const q = getMentionQueryAtCaret(composeRef.current)
    setMentionQuery(q)
    if (q !== null) {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        // a collapsed range can momentarily report an empty 0,0 rect right
        // after a DOM mutation — skip those, keep the last good position
        if (rect.left || rect.top || rect.width || rect.height) {
          setMentionRect({ left: rect.left, top: rect.bottom })
        }
      }
    }
    setDirty(true)
    syncRules()
  }

  function handleMentionSelect(type: MentionType, value: string, label: string) {
    if (!composeRef.current || mentionQuery === null) return
    insertMention(composeRef.current, mentionQuery.length, type, value, label)
    setMentionQuery(null)
    setMentionRect(null)
    composeRef.current.focus()
  }

  function handleKnobPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY
    function move(ev: PointerEvent) {
      const delta = Math.max(0, (ev.clientY - startY) / (scaleRef.current || 1))
      setPull(Math.min(60, delta), false)
    }
    function up() {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      idxRef.current = (idxRef.current + 1) % LAMP_PALETTE.length
      applyColour()
      setPull(0, true)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  function handleComposeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSave()
      return
    }
    if (mentionQuery !== null) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMentionQuery(null); setMentionRect(null); return }
      if (e.key === "Enter") {
        e.preventDefault()
        if (firstMatch) handleMentionSelect(firstMatch.type, firstMatch.value, firstMatch.label)
        return
      }
    }
    if (e.key === "Enter") {
      e.preventDefault()
      document.execCommand("insertText", false, "\n")
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSave()
    } else if (e.key === "Enter") {
      e.preventDefault()
      composeRef.current?.focus()
    }
  }

  // dropdown docks just under the line being typed on — computed from the
  // caret's real screen position (mentionRect), not the canvas's local
  // coordinate space, since this renders outside the scaled canvas
  const DOCK_WIDTH = 300
  let dockStyle: React.CSSProperties | undefined
  if (mentionQuery !== null && mentionRect) {
    const estHeight = 260
    const openUpward = window.innerHeight - mentionRect.top < estHeight + 20
    const top = openUpward ? mentionRect.top - estHeight - 26 : mentionRect.top + 6
    const left = Math.min(mentionRect.left, window.innerWidth - DOCK_WIDTH - 16)
    dockStyle = { position: "fixed", left: Math.max(16, left), top: Math.max(16, top), width: DOCK_WIDTH, zIndex: 200 }
  }

  return (
    <div className={`thought-composer${entered ? " tc-entered" : ""}${lit ? " tc-lit" : ""}`}>
      <div className="tc-stage">
        <div ref={canvasRef} className={`tc-canvas${lit ? " tc-lit" : ""}`}>
          <button
            className="tc-back-btn inline-flex items-center justify-center p-2.5 rounded-lg"
            style={{ border: "1.5px solid #0F0D0A", background: "#FCF9F5", boxShadow: "2px 2px 0 #0F0D0A" }}
            onClick={() => requestClose()}
            aria-label="Back"
          >
            <ArrowLeft size={14} />
          </button>

          {/* clipboard: hook + board + paper, one physical object */}
          <div className="tc-clipboard-group">
            <div className="tc-paper-back" />
            <div className="tc-paper-front" />

            <div className="tc-writer-wrap">
              <div className="tc-paper-margin" />
              <input
                type="text"
                className="tc-title-input"
                placeholder="Title (optional)"
                value={title}
                onChange={e => { setTitle(e.target.value); setDirty(true) }}
                onKeyDown={handleTitleKeyDown}
              />
              <div className="tc-writer-field">
                <div className="tc-rules" ref={rulesRef} />
                <div
                  ref={composeRef}
                  className="tc-writer"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck
                  data-placeholder="What's on your mind… (@ to mention)"
                  onInput={handleComposeInput}
                  onScroll={syncRules}
                  onKeyDown={handleComposeKeyDown}
                />
              </div>
              <div className="tc-paper-meta">
                <div className="tc-meta-left">
                  <span className="tc-date">{dateLabel}</span>
                  <span>{wordCount} {wordCount === 1 ? "word" : "words"}</span>
                  {error && <span style={{ color: "#C24A2E" }}>{error}</span>}
                </div>
                <div className="tc-meta-right">
                  {isEditing && (
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
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
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || wordCount === 0}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
                    style={{ background: "#0F0D0A", color: "#FFEADA", border: "1.5px solid #0F0D0A" }}
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    {saving ? "Saving…" : isEditing ? "Update · ⌘⏎" : "Save · ⌘⏎"}
                  </button>
                </div>
              </div>
            </div>

            {/* green hook / shelf */}
            <svg width="1280" height="832" style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 10 }}>
              <path d="M695.081 126C719.465 126 739.231 145.767 739.231 170.15H1187.71C1192.84 170.15 1197 174.312 1197 179.445V193.388H949.526V231.729C949.526 241.995 941.203 250.318 930.937 250.318H458.063C447.797 250.318 439.474 241.995 439.474 231.729V193.388H192V179.445C192 174.312 196.162 170.15 201.295 170.15H650.931C650.931 145.767 670.698 126 695.081 126ZM694.5 145.752C680.898 145.752 669.836 156.623 669.527 170.15H719.473C719.164 156.623 708.102 145.752 694.5 145.752Z" fill="#96C434" stroke="#171310" strokeWidth="2.3" />
            </svg>
          </div>

          {/* lamp cord */}
          <svg className="tc-cord-svg" width="1280" height="832">
            <g className="tc-cord-group">
              <rect ref={rectRef} x="101.5" y="-6" width="3" height="320" fill="#F2BD78" stroke="#171310" strokeWidth="2" />
              <circle
                ref={knobRef}
                className="tc-cord-knob"
                cx="103" cy="314" r="10.9091"
                fill="#F2BD78" stroke="#171310" strokeWidth="2.18"
                onPointerDown={handleKnobPointerDown}
              />
            </g>
          </svg>

          {/* music widget */}
          <div className="tc-widget">
            <svg width="385" height="169" viewBox="0 0 385 169" style={{ overflow: "visible", display: "block", pointerEvents: "none" }}>
              <defs>
                <radialGradient id="tcWmScreenGlow" cx="50%" cy="50%" r="70%">
                  <stop offset="0%" stopColor="#CFA2FF" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#CFA2FF" stopOpacity="0" />
                </radialGradient>
                <mask id="tcWmBar1"><rect x="218" y="32" width="4" height="13" rx="1" fill="white" /></mask>
                <mask id="tcWmBar2"><rect x="223" y="32" width="4" height="13" rx="1" fill="white" /></mask>
              </defs>
              <rect x="1" y="3" width="283" height="70" rx="11" fill="#A44EFF" stroke="#171310" strokeWidth="2" />
              <rect x="11" y="13" width="160" height="49" rx="7" fill="#0A0A0A" stroke="#171310" strokeWidth="2" />
              <rect x="11" y="13" width="160" height="49" rx="7" fill="url(#tcWmScreenGlow)" />
              <g style={{ transformOrigin: "216px 38px", animation: "tc-spinVinyl 8s linear infinite" }}>
                <path d="M216 1C236.435 1 253 17.5655 253 38C253 58.4345 236.435 75 216 75C195.565 75 179 58.4345 179 38C179 17.5655 195.565 1 216 1Z" fill="#BE82FF" stroke="#171310" strokeWidth="2" strokeLinecap="round" />
                <path d="M216 1C236.435 1 253 17.5655 253 38C253 58.4345 236.435 75 216 75" fill="none" stroke="#CFA2FF" strokeWidth="2" strokeLinecap="round" />
              </g>
              <circle cx="216" cy="38" r="23.0408" fill="#A44EFF" stroke="#171310" strokeWidth="2" />
              <path d="M205 43.8261V33.0309C205 32.2012 205.952 31.7324 206.61 32.2382L213.996 37.92C214.533 38.333 214.512 39.1492 213.955 39.5348L206.569 44.6483C205.906 45.1075 205 44.6328 205 43.8261Z" fill="#CFA2FF" stroke="#171310" strokeWidth="2" />
              <rect x="218" y="32" width="4" height="13" rx="1" fill="#CFA2FF" stroke="#171310" strokeWidth="4" mask="url(#tcWmBar1)" />
              <rect x="223" y="32" width="4" height="13" rx="1" fill="#CFA2FF" stroke="#171310" strokeWidth="4" mask="url(#tcWmBar2)" />
            </svg>
            <div style={{ position: "absolute", left: 11, top: 13, width: 160, height: 49, overflow: "hidden", display: "flex", alignItems: "center", pointerEvents: "none" }}>
              <div style={{ display: "flex", whiteSpace: "nowrap", animation: "tc-marquee 9s linear infinite" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: ".03em", color: "#CFA2FF", textShadow: "0 0 6px rgba(207,162,255,.6)", paddingRight: 28 }}>♪ Now Playing — Wildflower Radio</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: ".03em", color: "#CFA2FF", textShadow: "0 0 6px rgba(207,162,255,.6)", paddingRight: 28 }}>♪ Now Playing — Wildflower Radio</span>
              </div>
            </div>
          </div>

          {/* digital clock (live) */}
          <ThoughtComposerClock />
        </div>

        {/* ambient lamp light — a full-viewport layer, siblings with (not
            nested inside) the scaled canvas, so the glow always reaches every
            edge of the screen instead of being clipped to the canvas's own
            1280x832 box. viewBox + preserveAspectRatio="none" stretches the
            same relative geometry to whatever the real viewport is. */}
        <svg className="tc-lamp-light" viewBox="0 0 1280 832" preserveAspectRatio="none">
          <defs>
            <linearGradient id="tcLampLight" x1="117.229" y1="128.889" x2="1351.17" y2="1128.29" gradientUnits="userSpaceOnUse">
              <stop ref={stop1Ref} stopColor="#FF7D4E" stopOpacity="0.25" />
              <stop ref={stop2Ref} offset="0.716346" stopColor="#994B2F" />
            </linearGradient>
          </defs>
          <ellipse cx="521" cy="587.5" rx="808" ry="628.5" fill="url(#tcLampLight)" fillOpacity="0.25" style={{ transition: "fill .6s ease" }} />
        </svg>
      </div>

      {/* mention dropdown — rendered outside the scaled canvas so its fixed
          left/top (from the caret's real getBoundingClientRect) land correctly */}
      {mentionQuery !== null && dockStyle && (
        <div style={dockStyle}>
          <MentionDropdown
            tags={filteredTags}
            linksList={filteredLinks}
            visualsList={filteredVisuals}
            categories={filteredCategories}
            onSelect={handleMentionSelect}
          />
        </div>
      )}

      {/* discard-changes confirmation — in-app styled, not the browser's native confirm() */}
      {confirmingClose && (
        <div className="tc-confirm-overlay" onClick={() => setConfirmingClose(false)}>
          <div className="tc-confirm-card" onClick={e => e.stopPropagation()}>
            <p className="tc-confirm-title">{isEditing ? "Discard changes?" : "Discard this thought?"}</p>
            <p className="tc-confirm-body">
              {isEditing ? "Your edits haven't been saved." : "What you've written won't be saved."}
            </p>
            <div className="tc-confirm-actions">
              <button
                onClick={() => setConfirmingClose(false)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                style={{ border: "1.5px solid rgba(15,13,10,0.3)", color: "#6B5B4A" }}
              >
                Keep writing
              </button>
              <button
                onClick={() => { setConfirmingClose(false); requestClose(true) }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ border: "1.5px solid #E03D2F", color: "#E03D2F", background: "#FFF0EE" }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Thought Card ───────────────────────────────────────────────────────────

function ThoughtCard({ thought, links, visuals, onClick, onLinkClick, onVisualClick, onTagClick, onCategoryClick }: {
  thought: SavedThought
  links: SavedLink[]
  visuals: SavedVisual[]
  onClick: () => void
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
    <ThoughtPage rotation={rotation} className="mb-6 cursor-pointer" onClick={onClick}>
      {thought.title && (
        <p className="mb-1.5" style={{ margin: "0 0 6px", fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.05rem", fontWeight: 600 }}>
          {thought.title}
        </p>
      )}
      <p className="whitespace-pre-wrap" style={{ margin: 0 }}>{rendered}</p>
      <p className="text-xs opacity-40 mt-3" style={{ fontFamily: "'Manrope', sans-serif" }}>
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
        {thought.title && (
          <p style={{ margin: "0 0 6px", fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.05rem", fontWeight: 600 }}>
            {thought.title}
          </p>
        )}
        <p style={{ margin: 0 }}>{snippet}</p>
        <p className="text-xs opacity-40 mt-2" style={{ fontFamily: "'Manrope', sans-serif" }}>
          {new Date(thought.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </ThoughtPage>
    </motion.div>
  )
}

// ─── Thoughts View ──────────────────────────────────────────────────────────
// "Scattered pages" — this view lists what's already saved. Clicking a page
// reopens it in the same lamp-lit desk scene used for "New Post"
// (ThoughtComposerScene), already lit and pre-filled, no dark-room entrance.

function ThoughtsView({ thoughts, links, visuals, onThoughtClick, onLinkClick, onVisualClick, onTagClick, onCategoryClick }: {
  thoughts: SavedThought[]
  links: SavedLink[]
  visuals: SavedVisual[]
  onThoughtClick: (t: SavedThought) => void
  onLinkClick: (l: SavedLink) => void
  onVisualClick: (v: SavedVisual) => void
  onTagClick: (tag: string) => void
  onCategoryClick: (category: string) => void
}) {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      {thoughts.map(t => (
        <ThoughtCard
          key={t.id}
          thought={t}
          links={links}
          visuals={visuals}
          onClick={() => onThoughtClick(t)}
          onLinkClick={onLinkClick}
          onVisualClick={onVisualClick}
          onTagClick={onTagClick}
          onCategoryClick={onCategoryClick}
        />
      ))}
      {!thoughts.length && (
        <p className="text-sm text-muted-foreground opacity-50 text-center py-12">No thoughts yet — click "New Post" above to jot something down.</p>
      )}
    </div>
  )
}

// ─── Category Stack ────────────────────────────────────────────────────────

// Stack "thickness" (1-5 back layers) and stagger (2-10px) scale relative to
// the smallest/largest category in the current collection — the biggest pile
// is always the thickest, smallest is always just the front card alone.
// Width is shared so the two grids line up; height is set per stack type
// below since a text-only card and a photo card have very different natural
// sizes — forcing them to a single height either stretches one with dead
// space or clips the other.
// Matches the "Enter Recruitment — Hiring & Recruitment Services" PaperCard
// on the All links page — no image, a full 2-line summary, vibe+tags — as a
// floor: the stack should never render smaller than a real, fairly full card.
const STACK_CARD_W = 260
// padding around the front card — this is the only thing separating one
// row's stack from the next (grid row-gap is 0), so it directly sets the
// row spacing at 2x this value. Sized to ~1/3 of the previous 32px; the
// per-category stagger below is capped to stay safely inside it.
const STACK_PADDING = 11

function CategoryStack({ category, count, unitLabel, tags, paletteIndex, minCount, maxCount, onClick }: {
  category: string
  count: number
  // singular form — "link" or "image"; pluralised automatically
  unitLabel: string
  // real tags/vibes pulled from the category's items, so the front card's
  // tag row isn't empty — same component either way, links and images just
  // hand it different words
  tags: string[]
  paletteIndex: number
  minCount: number
  maxCount: number
  onClick: () => void
}) {
  const palette = STACK_PALETTES[paletteIndex % STACK_PALETTES.length]
  // Height matching the "Enter Recruitment" reference card at this width:
  // 2-line title + 2-line summary + two wrapped rows of pills (32 padding +
  // 38.5 title + 8 gap + 39 summary + 8 gap + 46 for two pill rows).
  const cardH = 180

  const layerCount = Math.round(mapRange(count, minCount, maxCount, 1, 5))
  const stagger = mapRange(count, minCount, maxCount, 1.5, 6)
  const backLayers = Array.from({ length: Math.max(0, layerCount - 1) }, (_, k) => layerCount - 1 - k)
  const tilt = getStackTilt(category)

  // Synthetic "link" so the front sheet is the exact PaperCard component —
  // same border/shadow/title/summary/tags layout — just reading the category
  // instead of a single saved link/image.
  const categoryCard: SavedLink = {
    id: category, url: "", title: category, slug: "", description: "",
    image_url: "", user_note: "", summary: `${count} ${count === 1 ? unitLabel : unitLabel + "s"}`,
    category, vibe: "", tags: tags.slice(0, 2), platform: "", created_at: "",
  }

  return (
    <motion.div
      whileHover={{ y: -8, transition: { type: "spring", stiffness: 400, damping: 20 } }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className="cursor-pointer relative"
      style={{ width: STACK_CARD_W + STACK_PADDING * 2, height: cardH + STACK_PADDING * 2, rotate: tilt }}
    >
      {/* Every layer — back and front — is built from the same card frame
          (rounded-lg, 2px ink border, 4px shadow) as PaperCardContent, so the
          whole pile reads as one family of card, just stacked and staggered. */}
      {backLayers.map(i => (
        <div
          key={i}
          className="absolute rounded-lg"
          style={{
            left: STACK_PADDING - i * stagger * 0.4,
            top: STACK_PADDING + i * stagger * 0.3,
            width: STACK_CARD_W, height: cardH,
            background: i % 2 === 0 ? palette.back : palette.mid,
            border: "2px solid #0F0D0A",
            transform: `rotate(${(i % 2 === 0 ? -(i * 2) : (i * 2)) * 0.6}deg)`,
            boxShadow: "4px 4px 0 #0F0D0A",
          }}
        />
      ))}
      {/* Front sheet — the exact PaperCard component */}
      <div
        className="absolute overflow-hidden rounded-lg"
        style={{ left: STACK_PADDING, top: STACK_PADDING, width: STACK_CARD_W, height: cardH, transform: "rotate(1deg)" }}
      >
        <PaperCardContent link={categoryCard} />
      </div>
      {/* Red pin marks it as a pile, not a single saved link */}
      <div
        className="absolute rounded-full"
        style={{
          width: 14, height: 14,
          background: "#F53535",
          border: "2px solid #0F0D0A",
          top: STACK_PADDING + 8, right: STACK_PADDING + 10,
          boxShadow: "1px 1px 0 #0F0D0A",
        }}
      />
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
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
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
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ background: "#0F0D0A", color: "#FFEADA", border: "1.5px solid #0F0D0A" }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
              </button>
            ) : (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ border: "1.5px solid rgba(15,13,10,0.3)", color: "#6B5B4A" }}>
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
                <input className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
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
              <select className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <span className="text-sm px-3 py-1 rounded-lg inline-block" style={{ background: "#FFE1A1", border: "1.5px solid #0F0D0A" }}>{draft.category}</span>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Summary</p>
            {editing ? (
              <textarea rows={4} className="w-full rounded-lg px-3 py-2 text-sm resize-none" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
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
              <input className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                placeholder="minimal, dark, editorial..." value={draft.vibe} onChange={e => setDraft({ ...draft, vibe: e.target.value })} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {vibes.length > 0 ? vibes.map(v => (
                  <span key={v} className="text-xs px-2.5 py-1 rounded-lg" style={{ background: "#FFE1A1", border: "1px solid #0F0D0A" }}>{v}</span>
                )) : <span className="text-xs text-muted-foreground opacity-50">—</span>}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Tags</p>
            {editing ? (
              <input className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                placeholder="design, tools, inspo..." value={tagsInput} onChange={e => setTagsInput(e.target.value)} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.length > 0 ? tags.map(t => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-lg" style={{ background: "#FFDEB3", border: "1px solid rgba(15,13,10,0.4)" }}>#{t}</span>
                )) : <span className="text-xs text-muted-foreground opacity-50">—</span>}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Your note</p>
            {editing ? (
              <input className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
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
                  <span key={v} className="text-xs px-2.5 py-1 rounded-lg" style={{ background: "#FFE1A1", border: "1px solid #0F0D0A" }}>{v}</span>
                )) : <span className="text-xs text-muted-foreground opacity-50">—</span>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.length > 0 ? tags.map(t => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-lg" style={{ background: "#FFDEB3", border: "1px solid rgba(15,13,10,0.4)" }}>#{t}</span>
                )) : <span className="text-xs text-muted-foreground opacity-50">—</span>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Your note</p>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm"
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

// ─── Import Panel ────────────────────────────────────────────────────────
// The exact same slide-in-drawer shell as LinkDetailPanel/VisualDetailPanel —
// same notched left edge, same backdrop/spring-in — instead of the old
// full-page paste/review/processing/done flow.

function ImportPanel({ onImportDone, onClose }: { onImportDone: () => void; onClose: () => void }) {
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

  const stepTitle = step === "paste" ? "Drop your links"
    : step === "review" ? `Review ${parsedLinks.length} links`
    : step === "processing" ? "Adding links"
    : "Done"

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
            <pattern id="notchBorderImport" x="0" y="0" width="14" height="40" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 1 11 A 9 9 0 0 1 1 29 L 1 40" fill="none" stroke="#0F0D0A" strokeWidth="2" />
            </pattern>
          </defs>
          <rect width="14" height="100%" fill="url(#notchBorderImport)" />
        </svg>

        {/* panel: clip-path cuts everything inside to the notched shape — no child background can overpaint the holes */}
        <div
          className="flex flex-col overflow-y-auto flex-1"
          style={{ background: "#FCF9F5", clipPath: PANEL_NOTCH_CLIP }}
        >
          <div className="flex items-center justify-between px-6 py-4 sticky top-0 z-10" style={{ background: "#FCF9F5", borderBottom: "2px solid #0F0D0A" }}>
            <h2 className="text-xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{stepTitle}</h2>
            <button onClick={onClose} className="opacity-40 hover:opacity-100"><X size={18} /></button>
          </div>

          <div className="px-6 py-6">
            {step === "paste" && (
              <>
                <p className="text-sm text-muted-foreground mb-4">Paste any text with links — URLs will be extracted automatically.</p>
                <textarea
                  className="w-full h-44 rounded-lg p-4 text-sm resize-none focus:outline-none"
                  style={{ border: "1.5px solid #0F0D0A", background: "#FFF8F0" }}
                  placeholder={"https://x.com/someone/status/...\nhttps://some-tool.com\n\nOr paste a whole block of text with links in it."}
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                />
                {error && <p className="text-destructive text-sm mt-2">{error}</p>}
                <button
                  onClick={handleParse}
                  disabled={!rawText.trim()}
                  className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40"
                  style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A" }}
                >
                  Parse links <ArrowRight size={15} />
                </button>
              </>
            )}

            {step === "review" && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-muted-foreground">Add a note for social links — helps Claude understand what they're about.</p>
                  <button onClick={() => setStep("paste")} className="shrink-0 ml-3 text-sm text-muted-foreground hover:text-foreground">← back</button>
                </div>
                <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
                  {parsedLinks.map((link, i) => (
                    <div key={link.url} className="rounded-lg p-3" style={{ background: "#FFF8F0", border: "1.5px solid #0F0D0A" }}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs px-2 py-0.5 rounded-lg font-medium" style={{ background: "#FFE1A1", border: "1px solid #0F0D0A" }}>{link.platform}</span>
                          <span className="text-xs text-muted-foreground truncate opacity-60">{link.url}</span>
                        </div>
                        <button onClick={() => setParsedLinks(prev => prev.filter((_, idx) => idx !== i))} className="shrink-0 opacity-40 hover:opacity-100"><X size={13} /></button>
                      </div>
                      {isSocialPlatform(link.platform) && (
                        <input type="text" placeholder="What is this about?"
                          value={link.note}
                          onChange={e => setParsedLinks(prev => prev.map((l, idx) => idx === i ? { ...l, note: e.target.value } : l))}
                          className="w-full text-xs rounded-lg px-3 py-1.5 focus:outline-none"
                          style={{ border: "1px solid rgba(15,13,10,0.3)", background: "#FCF9F5" }}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {error && <p className="text-destructive text-sm mt-3">{error}</p>}
                <button
                  onClick={handleImport}
                  className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold"
                  style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A" }}
                >
                  Characterise & save <ArrowRight size={15} />
                </button>
              </>
            )}

            {step === "processing" && (
              <div className="py-8 text-center">
                <Loader2 size={28} className="animate-spin mx-auto mb-5 opacity-40" />
                <p className="text-sm font-medium mb-5">{status}</p>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#FFDEB3", border: "1px solid #0F0D0A" }}>
                  <motion.div className="h-full rounded-full" style={{ background: "#0F0D0A" }} animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} />
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="py-8 text-center">
                <div className="w-14 h-14 rounded-lg flex items-center justify-center mx-auto mb-5" style={{ background: "#FFE1A1", border: "2px solid #0F0D0A", boxShadow: "3px 3px 0 #0F0D0A" }}>
                  <Check size={22} />
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  {importedCount} saved{skippedCount > 0 && `, ${skippedCount} duplicate${skippedCount !== 1 ? "s" : ""} skipped`}.
                </p>
                <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A" }}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
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
        const haystack = [t.title, t.content].filter(Boolean).join(" ").toLowerCase()
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
            className="w-full pl-11 pr-12 py-4 rounded-lg text-base focus:outline-none"
            style={{ border: "2px solid #0F0D0A", background: "#FCF9F5", fontFamily: "'Manrope', sans-serif", boxShadow: "4px 4px 0 #0F0D0A" }}
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
            className="inline-flex items-center justify-center p-2.5 rounded-lg"
            style={{ border: "1.5px solid #0F0D0A", background: "#FCF9F5", boxShadow: "2px 2px 0 #0F0D0A" }}
            aria-label="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h2 className="text-2xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{category}</h2>
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

// ─── Visual Category View ───────────────────────────────────────────────────
// The category stack itself is CategoryStack (shared with Links) — see below.

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
            className="inline-flex items-center justify-center p-2.5 rounded-lg"
            style={{ border: "1.5px solid #0F0D0A", background: "#FCF9F5", boxShadow: "2px 2px 0 #0F0D0A" }}
            aria-label="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h2 className="text-2xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{category}</h2>
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

function VisualBoardView({ visuals, onCardClick, visualView, onSetVisualView, activeVisualCategory, onCategoryClick, onBackFromCategory, onRecluster, reclustering }: {
  visuals: SavedVisual[]
  onCardClick: (v: SavedVisual) => void
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
  const categoryCounts = categories.map(cat => grouped[cat].length)
  const minCount = categoryCounts.length ? Math.min(...categoryCounts) : 0
  const maxCount = categoryCounts.length ? Math.max(...categoryCounts) : 0

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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ border: "1.5px solid rgba(15,13,10,0.2)" }}>
          <button
            onClick={() => onSetVisualView("all")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={visualView === "all" ? { background: "#0F0D0A", color: "#FFEADA" } : { color: "#6B5B4A" }}
          >
            All images
          </button>
          <button
            onClick={() => onSetVisualView("categories")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
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
          <p className="text-sm text-muted-foreground opacity-60">Your visual board is empty — click "Add images" above to get started</p>
        </div>
      ) : visualView === "all" ? (
        // same fix as "All links": real masonry (drops each card into the
        // shortest column) instead of CSS `columns`, which fills column-by-
        // column and reads out of order
        <ResponsiveMasonry columnsCountBreakPoints={{ 0: 2, 640: 3, 1024: 4, 1280: 5 }}>
          <Masonry gutter="16px">
            {visuals.map((visual, i) => (
              <VisualCard key={visual.id} visual={visual} onClick={() => onCardClick(visual)} index={i} layoutClassName="cursor-pointer" />
            ))}
          </Masonry>
        </ResponsiveMasonry>
      ) : (
        <motion.div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-0 justify-items-center"
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
                count={grouped[cat].length}
                unitLabel="image"
                tags={[...new Set(grouped[cat].flatMap(v => Array.isArray(v.vibe) ? v.vibe : []))]}
                paletteIndex={i}
                minCount={minCount}
                maxCount={maxCount}
                onClick={() => onCategoryClick(cat)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  )
}

// ─── Landing View ──────────────────────────────────────────────────────────

function LandingView({ links, linksView, onSetLinksView, onCardClick, onCategoryClick, onRecluster, reclustering }: {
  links: SavedLink[]
  linksView: "all" | "categories"
  onSetLinksView: (v: "all" | "categories") => void
  onCardClick: (link: SavedLink) => void
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
  const categoryCounts = categories.map(cat => grouped[cat].length)
  const minCount = categoryCounts.length ? Math.min(...categoryCounts) : 0
  const maxCount = categoryCounts.length ? Math.max(...categoryCounts) : 0

  if (!links.length) return (
    <div className="flex-1 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        {/* Empty desk illustration */}
        <div className="relative mx-auto mb-6" style={{ width: 160, height: 180 }}>
          <div className="absolute inset-0 rounded-lg" style={{ background: "#FFDEB3", border: "2px solid #0F0D0A", transform: "rotate(-6deg)", boxShadow: "3px 3px 0 #0F0D0A" }} />
          <div className="absolute inset-0 rounded-lg" style={{ background: "#FCF9F5", border: "2px solid #0F0D0A", transform: "rotate(-1deg)", boxShadow: "3px 3px 0 #0F0D0A" }} />
          <div className="absolute inset-0 rounded-lg flex items-center justify-center" style={{ background: "#FFFFFF", border: "2px solid #0F0D0A", boxShadow: "4px 4px 0 #0F0D0A" }}>
            <Plus size={28} className="opacity-20" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground opacity-60">Your desk is empty — add some links to get started</p>
      </motion.div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ border: "1.5px solid rgba(15,13,10,0.2)" }}>
          <button
            onClick={() => onSetLinksView("all")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={linksView === "all" ? { background: "#0F0D0A", color: "#FFEADA" } : { color: "#6B5B4A" }}
          >
            All links
          </button>
          <button
            onClick={() => onSetLinksView("categories")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={linksView === "categories" ? { background: "#0F0D0A", color: "#FFEADA" } : { color: "#6B5B4A" }}
          >
            Categories
          </button>
        </div>
        {linksView === "categories" ? (
          <button
            onClick={onRecluster}
            disabled={reclustering || links.length < 5}
            className="flex items-center gap-1.5 text-xs opacity-40 hover:opacity-80 disabled:opacity-20 transition-opacity"
          >
            <RefreshCw size={11} className={reclustering ? "animate-spin" : ""} />
            {reclustering ? "Reorganising..." : "Reorganise categories"}
          </button>
        ) : (
          <p className="text-xs text-muted-foreground opacity-50">{links.length} {links.length === 1 ? "link" : "links"}</p>
        )}
      </div>

      {linksView === "all" ? (
        // real masonry (measures rendered heights, drops each card into the
        // shortest column) instead of CSS `columns`, which fills column-by-
        // column and scrambles reading order — this keeps a natural
        // left-to-right flow while still packing tightly, no dead gaps
        <ResponsiveMasonry columnsCountBreakPoints={{ 0: 2, 640: 3, 1024: 4, 1280: 5 }}>
          <Masonry gutter="16px">
            {links.map((link, i) => (
              <PaperCard key={link.id} link={link} onClick={() => onCardClick(link)} index={i} />
            ))}
          </Masonry>
        </ResponsiveMasonry>
      ) : (
        <motion.div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-0 justify-items-center"
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
                count={grouped[cat].length}
                unitLabel="link"
                tags={[...new Set(grouped[cat].flatMap(l => Array.isArray(l.tags) ? l.tags : []))]}
                paletteIndex={i}
                minCount={minCount}
                maxCount={maxCount}
                onClick={() => onCategoryClick(cat)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
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
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#FFEADA", fontFamily: "'Manrope', sans-serif" }}>
      <div className="w-full max-w-sm px-8 py-10" style={{ background: "#FCF9F5", border: "2px solid #0F0D0A", boxShadow: "4px 4px 0 #0F0D0A" }}>
        <p className="text-2xl font-semibold mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>linkdesk</p>
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
              style={{ border: "2px solid #0F0D0A", background: "#FFEADA", fontFamily: "'Manrope', sans-serif" }}
            />
            <button type="submit" disabled={loading}
              className="px-4 py-2.5 text-sm font-semibold rounded-lg"
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
  const [view, setView] = useState<"desk" | "category">("desk")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [linksView, setLinksView] = useState<"all" | "categories">("all")
  const [showLinkImport, setShowLinkImport] = useState(false)
  const [selectedLink, setSelectedLink] = useState<SavedLink | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [reclustering, setReclustering] = useState(false)

  const [board, setBoard] = useState<"links" | "images" | "thoughts">("links")
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
  const [composerOpen, setComposerOpen] = useState(false)
  const [selectedThought, setSelectedThought] = useState<SavedThought | null>(null)
  const [showImageUpload, setShowImageUpload] = useState(false)

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
    const { data, error } = await supabase.from("thoughts").select("id, content, title, created_at").order("created_at", { ascending: false })
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

  // Draw the folder tab strip — on mount, whenever the active tab changes, and on resize
  useEffect(() => {
    requestAnimationFrame(() => drawStrip(board))
  }, [board])

  useEffect(() => {
    const onResize = () => drawStrip(board)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [board])

  function handleVisualUploaded(visual: SavedVisual) {
    setVisuals(prev => [visual, ...prev])
  }

  function handleThoughtSaved(thought: SavedThought) {
    setThoughts(prev => prev.some(t => t.id === thought.id)
      ? prev.map(t => t.id === thought.id ? thought : t)
      : [thought, ...prev])
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
    <div style={{ width: "100%", height: "100vh", fontFamily: "'Manrope', sans-serif", background: "#FFDEB3", display: "flex", flexDirection: "column", padding: 20, boxSizing: "border-box", overflow: "hidden" }}>
    <div className="folder" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* CSS tabs — fixed size, fixed gap, fixed radius */}
      <div className="tab-row" id="tab-row">
        <div id="tab-links" onClick={() => setBoard("links")} className={board === "links" ? "tab active" : "tab inactive"} style={{ background: "#FF7D4E" }}>Links</div>
        <div id="tab-images" onClick={() => setBoard("images")} className={board === "images" ? "tab active" : "tab inactive"} style={{ background: "#54B5DF" }}>Images</div>
        <div id="tab-thoughts" onClick={() => setBoard("thoughts")} className={board === "thoughts" ? "tab active" : "tab inactive"} style={{ background: "#96C434" }}>Thoughts</div>
      </div>

      {/* SVG strip — only this stretches, gap measured from CSS tabs above */}
      <div className="strip-wrap" id="strip-wrap">
        <svg id="strip-svg" style={{ display: "block", width: "100%", height: 12 }} />
      </div>

      {/* Folder body */}
      <div className="folder-body">
        {/* Header */}
        <header className="px-8 py-5 flex items-center justify-between shrink-0" style={{ borderBottom: "2px solid rgba(15,13,10,0.12)" }}>
          <button
            onClick={() => { setBoard("links"); setView("desk"); setActiveCategory(null) }}
            className="text-xl font-semibold tracking-tight"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            linkdesk
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSearchInitialQuery(""); setShowSearch(true) }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ border: "1.5px solid rgba(15,13,10,0.25)", background: "transparent" }}
            >
              <Search size={14} className="opacity-60" /> Search
            </button>
            {board === "links" && (
              <button
                onClick={() => setShowLinkImport(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A", boxShadow: "2px 2px 0 rgba(15,13,10,0.3)" }}
              >
                <Plus size={14} /> Add links
              </button>
            )}
            {board === "images" && (
              <button
                onClick={() => setShowImageUpload(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A", boxShadow: "2px 2px 0 rgba(15,13,10,0.3)" }}
              >
                <Plus size={14} /> Add images
              </button>
            )}
            {board === "thoughts" && (
              <button
                onClick={() => setComposerOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A", boxShadow: "2px 2px 0 rgba(15,13,10,0.3)" }}
              >
                <Plus size={14} /> New Post
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
          {board === "images" ? (
            visualsLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin opacity-30" />
              </div>
            ) : (
              <VisualBoardView
                visuals={visuals}
                onCardClick={visual => setSelectedVisual(visual)}
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
                onThoughtClick={thought => setSelectedThought(thought)}
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
              linksView={linksView}
              onSetLinksView={setLinksView}
              onCardClick={link => setSelectedLink(link)}
              onCategoryClick={cat => { setActiveCategory(cat); setView("category") }}
              onRecluster={handleRecluster}
              reclustering={reclustering}
            />
          )}
        </div>
      </div>
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

      {/* Image upload panel */}
      <AnimatePresence>
        {showImageUpload && (
          <ImageUploadPanel
            onClose={() => setShowImageUpload(false)}
            onUploaded={handleVisualUploaded}
          />
        )}
      </AnimatePresence>

      {/* Import (add links) panel */}
      <AnimatePresence>
        {showLinkImport && (
          <ImportPanel
            onImportDone={handleImportDone}
            onClose={() => setShowLinkImport(false)}
          />
        )}
      </AnimatePresence>

      {/* "New Post" composer and "open a saved note" share the same lamp-lit
          desk scene — opening an existing thought just skips the dark-room
          entrance and starts already lit, with its content hydrated in. */}
      {(composerOpen || selectedThought) && (
        <ThoughtComposerScene
          key={selectedThought ? selectedThought.id : "new"}
          thought={selectedThought}
          links={links}
          visuals={visuals}
          onSaved={handleThoughtSaved}
          onDeleted={id => setThoughts(prev => prev.filter(t => t.id !== id))}
          onClose={() => { setComposerOpen(false); setSelectedThought(null) }}
        />
      )}
    </div>
  )
}
