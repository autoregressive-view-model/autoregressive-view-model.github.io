"""Set the ?v= cache tag of every local script, style and page that main.html / technical_details.html load
to the first 12 hex digits of the file's SHA-256, so browsers and CDNs fetch changed files.

Run from the repo root after editing any of those files:
    python3 tools/refresh_versions.py
"""
import hashlib
import pathlib
import re

PAGES = ("technical_details.html", "main.html")  # main.html embeds technical_details.html: tag it last
REF = re.compile(r'((?:src|href|poster)=")([^"?#:]+)\?v=([0-9a-f]+)(")')

for page in PAGES:
    path = pathlib.Path(page)
    html = path.read_text()

    def retag(match: re.Match) -> str:
        target = pathlib.Path(match.group(2))
        if not target.is_file():
            return match.group(0)
        tag = hashlib.sha256(target.read_bytes()).hexdigest()[:12]
        if tag != match.group(3):
            print(f"{page}: {target} {match.group(3)} -> {tag}")
        return f"{match.group(1)}{match.group(2)}?v={tag}{match.group(4)}"

    path.write_text(REF.sub(retag, html))
