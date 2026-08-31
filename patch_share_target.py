#!/usr/bin/env python3
"""
One-time patch: wires up the Android share-target so that a link shared
into Linkdesk automatically opens the Add Links panel with the link
pre-filled in the textarea.

Run this from inside your linkdesk project folder:
    python3 patch_share_target.py
"""

PATH = "src/app/App.tsx"

with open(PATH, "r") as f:
    content = f.read()

original = content
changes_made = []

# --- Change 1: add sharedText state ---
old1 = '  const [showLinkImport, setShowLinkImport] = useState(false)'
new1 = ('  const [showLinkImport, setShowLinkImport] = useState(false)\n'
        '  const [sharedText, setSharedText] = useState<string | null>(null)')
if content.count(old1) == 1:
    content = content.replace(old1, new1)
    changes_made.append("1. Added sharedText state")
else:
    print(f"MISMATCH on change 1 — found {content.count(old1)} occurrences, expected 1. Stopping, no changes written.")
    raise SystemExit(1)

# --- Change 2: add useEffect that reads ?url=&text= from the page URL ---
old2 = '  useEffect(() => { fetchLinks() }, [])'
new2 = ('''  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sharedUrl = params.get("url") || ""
    const sharedTextParam = params.get("text") || ""
    const combined = [sharedUrl, sharedTextParam].filter(Boolean).join("\\n")
    if (combined) {
      setSharedText(combined)
      setShowLinkImport(true)
      window.history.replaceState({}, "", window.location.pathname)
    }
  }, [])
  useEffect(() => { fetchLinks() }, [])''')
if content.count(old2) == 1:
    content = content.replace(old2, new2)
    changes_made.append("2. Added shared-link detection useEffect")
else:
    print(f"MISMATCH on change 2 — found {content.count(old2)} occurrences, expected 1. Stopping, no changes written.")
    raise SystemExit(1)

# --- Change 3: pass sharedText into ImportPanel, clear it on close ---
old3 = '''      <AnimatePresence>
        {showLinkImport && (
          <ImportPanel
            onImportDone={handleImportDone}
            onClose={() => setShowLinkImport(false)}
          />
        )}
      </AnimatePresence>'''
new3 = '''      <AnimatePresence>
        {showLinkImport && (
          <ImportPanel
            onImportDone={handleImportDone}
            onClose={() => { setShowLinkImport(false); setSharedText(null) }}
            initialText={sharedText || undefined}
          />
        )}
      </AnimatePresence>'''
if content.count(old3) == 1:
    content = content.replace(old3, new3)
    changes_made.append("3. Wired sharedText into ImportPanel")
else:
    print(f"MISMATCH on change 3 — found {content.count(old3)} occurrences, expected 1. Stopping, no changes written.")
    raise SystemExit(1)

# --- Change 4: ImportPanel accepts initialText and prefills rawText ---
old4 = '''function ImportPanel({ onImportDone, onClose }: { onImportDone: () => void; onClose: () => void }) {
  const [step, setStep] = useState<"paste" | "review" | "processing" | "done">("paste")
  const [rawText, setRawText] = useState("")'''
new4 = '''function ImportPanel({ onImportDone, onClose, initialText }: { onImportDone: () => void; onClose: () => void; initialText?: string }) {
  const [step, setStep] = useState<"paste" | "review" | "processing" | "done">("paste")
  const [rawText, setRawText] = useState(initialText || "")'''
if content.count(old4) == 1:
    content = content.replace(old4, new4)
    changes_made.append("4. ImportPanel now accepts and prefills initialText")
else:
    print(f"MISMATCH on change 4 — found {content.count(old4)} occurrences, expected 1. Stopping, no changes written.")
    raise SystemExit(1)

with open(PATH, "w") as f:
    f.write(content)

print("Success! Applied:")
for c in changes_made:
    print("  " + c)
print(f"\n{PATH} has been updated.")
