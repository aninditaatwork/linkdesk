import React, { useState, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "motion/react"
import { createClient } from "@supabase/supabase-js"
import { Search, Plus, ExternalLink, Loader2, X, ArrowRight, ArrowLeft, Pencil, Check, Trash2, RefreshCw } from "lucide-react"

const SUPABASE_URL = "https://sobwdyjbgecipxhvhrtu.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_5_Y3NIGFNQK-zyyE_DVKcA_tpclZ9g8"
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/characterize-links`
const CLUSTER_FN_URL = `${SUPABASE_URL}/functions/v1/cluster-links`
const SEARCH_FN_URL = `${SUPABASE_URL}/functions/v1/search-links`

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
        await supabase.from("links").update({ title: r.title || draft.title, summary: r.summary, category: r.category, vibe: r.vibe, tags: r.tags, image_url: r.image_url || draft.image_url }).eq("id", link.id)
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

function SearchView({ links, onCardClick, onClose }: { links: SavedLink[]; onCardClick: (l: SavedLink) => void; onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SavedLink[]>([])
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
      const keywordResults = links.filter(link => {
        const haystack = [
          link.title, link.summary, link.vibe, link.category,
          link.user_note, link.description, link.platform,
          ...(Array.isArray(link.tags) ? link.tags : []),
        ].join(" ").toLowerCase()
        return q.split(" ").every(word => haystack.includes(word))
      })

      try {
        const res = await semanticPromise
        if (!res.ok) throw new Error("Search failed")
        const { results: semanticHits } = await res.json()
        const hits: SavedLink[] = semanticHits ?? []

        // Merge: semantic first, append any keyword-only matches not already present
        const seen = new Set(hits.map(l => l.id))
        const combined = [...hits, ...keywordResults.filter(l => !seen.has(l.id))]
        setResults(combined)
      } catch (_) {
        // Semantic failed — fall back to keyword results only
        setResults(keywordResults)
      } finally {
        setSearching(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [query, links])

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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 max-w-6xl mx-auto">
              {results.map((link, i) => (
                <PaperCard key={link.id} link={link} onClick={() => onCardClick(link)} index={i} />
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
  const [loading, setLoading] = useState(false)

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
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

  const categories = useMemo(() => [...new Set(links.map(l => l.category).filter(Boolean))].sort(), [links])

  async function fetchLinks() {
    const { data, error } = await supabase.from("links").select("*").order("created_at", { ascending: false })
    if (!error && data) setLinks(data)
    setLoading(false)
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
        <button
          onClick={() => { setView("desk"); setActiveCategory(null) }}
          className="text-xl font-semibold tracking-tight"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          linkdesk
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-sm font-medium"
            style={{ border: "1.5px solid rgba(15,13,10,0.25)", background: "transparent" }}
          >
            <Search size={14} className="opacity-60" /> Search
          </button>
          <button
            onClick={() => setView("import")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-sm font-semibold"
            style={{ background: "#0F0D0A", color: "#FFEADA", border: "2px solid #0F0D0A", boxShadow: "2px 2px 0 rgba(15,13,10,0.3)" }}
          >
            <Plus size={14} /> Add links
          </button>
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
        {loading ? (
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
            onCardClick={link => {
              setSelectedLink(link)
            }}
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
    </div>
  )
}
