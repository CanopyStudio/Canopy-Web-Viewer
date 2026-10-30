"""Canopy Board's look, brought into the web viewer, so the two stay the same.

    python3 tools/from-board.py [path to Canopy Apps]          writes js/look.js, js/icons.js and icons.html
    python3 tools/from-board.py [path to Canopy Apps] --check  only says what differs (nothing is written)

From Board's own files: its themes (Board/Themes) and sizes (Board/style.json) into js/look.js; its icons (Board/Icons,
else Kit/Icons) into js/icons.js; and icons.html, a page of every icon the viewer uses, where each comes from and
where it is used. The Canopy Apps folder is looked for beside this repo when no path is given."""
import json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The viewer's icons: its name for each, the desktop app's icon it is ("~" before a name: that icon mirrored, for one
# pointing the other way), and where the viewer uses it.
ICONS = [
    ("back", "~fold", "Back: the top bar, and swiping back"),
    ("forward", "fold", "Forward, in the files' top bar"),
    ("chevron", "fold", "A folder's row: it opens"),
    ("open", "open", "A heading that can fold, open"),
    ("more", "more", "Account, and a list's options"),
    ("undo", "Undo", "Undo, in the top bars"),
    ("redo", "Redo", "Redo, in the top bars"),
    ("plus", "plus", "New list, new board, new project, Add task"),
    ("link", "link", "An entry's link, and Link in its menu"),
    ("lock", "lock", "What is picked on the canvas, locked"),
    ("pin", "pin", "Pinning a project"),
    ("folder", "folder", "A folder's row"),
    ("file", "file", "A project"),
    ("photo", "file image", "Add a photo; an image's row"),
    ("fit", "full", "Fit everything, fit the board"),
    ("lists", "List", "The Lists tab"),
    ("boards", "panel Boards", "The Boards tab"),
    ("canvas", "kind grid", "The Canvas tab"),
    ("download", "export", "Save a copy (a project opened from the phone)"),
    ("trash", "trash", "Delete, in menus"),
    ("close", "x", "Closing an image"),
    ("tick", "check mark", "A ticked entry's check box"),
    ("handle", "drag handle", "Reorder: an entry's handle"),
    ("saved", "saved", "Saved, in the top bars"),
    ("saving", "saving", "Saving"),
    ("waiting", "not saved", "Not saved yet (offline, say)"),
]

def apps_folder():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args: return os.path.abspath(args[0])
    for name in ("canopyboard-next", "Canopy Apps"):
        p = os.path.join(os.path.dirname(HERE), name)
        if os.path.isdir(os.path.join(p, "Board")): return p
    sys.exit("Canopy Apps not found: give its folder, e.g. python3 tools/from-board.py ../Canopy\\ Apps")

def loose_json(path):   # (Board's files have // comments)
    return json.loads(re.sub(r"^\s*//.*$", "", open(path, encoding="utf-8").read(), flags=re.M))

def icon_svg(apps, name):
    mirror = name.startswith("~"); name = name.lstrip("~")
    for where in ("Board/Icons", "Kit/Icons"):
        f = os.path.join(apps, where, name + ".svg")
        if os.path.exists(f): break
    else: return None, None
    t = open(f, encoding="utf-8").read()
    box = re.search(r'viewBox="([^"]+)"', re.search(r"<svg[^>]*>", t).group(0)).group(1)
    inner = re.search(r"<svg[^>]*>(.*)</svg>", t, re.S).group(1)
    inner = re.sub(r'\s*(data-min-width|stroke-miterlimit)="[^"]*"', "", inner)
    inner = re.sub(r"\s*\n\s*", "", inner).strip()
    if box != "0 0 24 24": inner = '<svg viewBox="%s" width="24" height="24">%s</svg>' % (box, inner)   # (drawn in an area of its own)
    if mirror: inner = '<g transform="matrix(-1 0 0 1 24 0)">%s</g>' % inner
    return inner, os.path.relpath(f, apps).replace(os.sep, "/")

def build(apps):
    out = {}
    # Themes and sizes.
    themes = {}
    for f in sorted(os.listdir(os.path.join(apps, "Board/Themes"))):
        if not f.endswith(".json"): continue
        t = loose_json(os.path.join(apps, "Board/Themes", f))
        themes[f[:-5]] = {"order": t.get("order", 99), "about": t.get("about", ""), "colors": {k: "#" + v for k, v in t["colors"].items()}}
    style = loose_json(os.path.join(apps, "Board/style.json"))
    sizes = {}
    for group in ("sizes", "spacing", "panels", "shadows", "cards"): sizes.update(style.get(group, {}))
    out["js/look.js"] = ("// Canopy Board's themes and sizes, as its own files have them (Board/Themes, Board/style.json): written by\n"
        "// tools/from-board.py, not by hand. The viewer uses them as they are, its corners and type a little bigger for fingers.\n"
        "export const themes = " + json.dumps(dict(sorted(themes.items(), key=lambda kv: kv[1]["order"])), indent=4) + ";\n"
        "export const sizes = " + json.dumps(sizes, indent=4) + ";\n")
    # Icons.
    got, rows, missing = {}, [], []
    for name, source, use in ICONS:
        svg, path = icon_svg(apps, source)
        if svg is None: missing.append((name, source)); continue
        got[name] = svg; rows.append((name, source, path, use, svg))
    out["js/icons.js"] = ("// Canopy Board's icons (its Board/Icons, else the Kit's Kit/Icons), as drawn there: written by tools/from-board.py,\n"
        "// not by hand (icons.html shows them all). Named for what they do here.\n"
        "export const boardIcons = {\n" + ",\n".join("    %s: %s" % (json.dumps(k), json.dumps(v)) for k, v in got.items()) + "\n};\n")
    cells = "".join('<tr><td class="i"><svg viewBox="0 0 24 24" width="28" height="28">%s</svg></td><td><b>%s</b></td><td>%s%s</td><td><code>%s</code></td><td>%s</td></tr>'
                    % (svg, name, source.lstrip("~"), " (mirrored)" if source.startswith("~") else "", path, use) for name, source, path, use, svg in rows)
    out["icons.html"] = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "<title>Canopy Web Viewer icons</title>\n<!-- Written by tools/from-board.py, not by hand. -->\n"
        "<style>body{margin:0;padding:24px;background:#161717;color:#EAECEB;font:14px/1.4 system-ui,sans-serif}h1{font-size:18px;margin:0 0 6px}"
        "p{color:#A5A8A7;margin:0 0 18px}table{border-collapse:collapse;width:100%;max-width:980px}td{padding:8px 10px;border-top:1px solid #343A38;vertical-align:middle}"
        "td.i{width:40px;color:#EAECEB}code{color:#A5A8A7;font-size:12px}</style></head><body>\n"
        "<h1>The web viewer's icons</h1><p>Each is one of Canopy Board's own (Board/Icons, else Kit/Icons), copied in by tools/from-board.py.</p>\n"
        "<table><tr><td></td><td><b>Here</b></td><td><b>Board's icon</b></td><td><b>Its file</b></td><td><b>Where it's used</b></td></tr>\n" + cells + "</table></body></html>\n")
    return out, missing

def used_icons():
    t = open(os.path.join(HERE, "js/app.js"), encoding="utf-8").read()
    return set(re.findall(r'icon\("([^"]+)"', t)) | set(re.findall(r'iconButton\("[^"]*", "([^"]+)"', t))

def main():
    apps = apps_folder()
    out, missing = build(apps)
    check = "--check" in sys.argv
    problems = ["%s: Board has no icon %r" % (n, s) for n, s in missing]
    known = {n for n, _, _ in ICONS}
    problems += ["the viewer uses icon %r, which isn't one of Board's (add it to ICONS here)" % n for n in sorted(used_icons() - known)]
    for path, text in out.items():
        full = os.path.join(HERE, path)
        now = open(full, encoding="utf-8").read() if os.path.exists(full) else None
        if now == text: continue
        if check: problems.append("%s differs from Board's (run without --check to bring it across)" % path)
        else: open(full, "w", encoding="utf-8", newline="\n").write(text); print("written:", path)
    for p in problems: print("!", p)
    if not problems: print("The viewer matches Board.")
    sys.exit(1 if problems and check else 0)

main()
