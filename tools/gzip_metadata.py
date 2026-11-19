"""Store site metadata as individually gzipped JSON and update the asset map."""

import argparse
import gzip
import json
from pathlib import Path


def gzip_metadata(site: Path) -> None:
    map_path = site / "assets" / "asset_map.json"
    asset_map = json.loads(map_path.read_bytes())
    assets = sorted({
        target.removesuffix(".gz") for target in asset_map["urls"].values()
        if target.startswith(("assets/metadata/", "assets/cameras/"))
        and target.endswith((".json", ".json.gz"))
    })
    renamed = {}
    for asset in assets:
        original = site / asset
        compressed = original.with_suffix(".json.gz")
        if original.is_file():
            compressed.write_bytes(gzip.compress(original.read_bytes(), compresslevel=9, mtime=0))
            renamed[asset] = compressed.relative_to(site).as_posix()
        elif not compressed.is_file():
            raise FileNotFoundError(original)

    if renamed:
        asset_map["urls"] = {
            source: renamed.get(target, target) for source, target in asset_map["urls"].items()
        }
        pending_map = map_path.with_suffix(".json.tmp")
        pending_map.write_text(json.dumps(asset_map, separators=(",", ":")), encoding="utf-8")
        pending_map.replace(map_path)
        for asset in renamed:
            (site / asset).unlink()
    print(f"Gzipped {len(renamed)} JSON assets in {site}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path)
    gzip_metadata(parser.parse_args().site)
