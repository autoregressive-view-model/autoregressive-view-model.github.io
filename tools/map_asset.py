"""Map an original media URL to a file in assets/ so the page loads it from this repo.

Usage (from the repo root):
    python3 tools/map_asset.py '<original URL as in the page data>' assets/videos/NAME.mp4
"""
import json
import sys
import urllib.parse

url, target = sys.argv[1], sys.argv[2]
parts = urllib.parse.urlsplit(url)
key = f"{parts.scheme}://{parts.netloc}" + urllib.parse.unquote(parts.path)  # canonical() in homepage_assets.js

path = "assets/asset_map.json"
data = json.load(open(path))
data["urls"][key] = target
data["asset_count"] = len(data["urls"])  # homepage_assets.js rejects the map if this count is off
json.dump(data, open(path, "w"), separators=(",", ":"))
print(f"{key} -> {target}")
