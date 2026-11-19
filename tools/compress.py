"""Convert PNGs to WebP and encode H.264 at source resolution (teaser capped at 720p)."""
import concurrent.futures as cf, json, pathlib, shutil, subprocess, time

ORIG, OUT = pathlib.Path("orig"), pathlib.Path("out")
FF, CWEBP = "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/bin/cwebp"

def image(src: pathlib.Path) -> dict:
    rel = src.relative_to(ORIG)
    if src.suffix.lower() != ".png" or src.stat().st_size == 0:   # empty upstream files stay as they are
        dst = OUT / rel; dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dst)
    else:
        dst = (OUT / rel).with_suffix(".webp"); dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() and dst.stat().st_size > 0:
            return {"orig": str(rel), "new": str(dst.relative_to(OUT)), "before": src.stat().st_size, "after": dst.stat().st_size}
        try:
            subprocess.run([CWEBP, "-quiet", "-q", "80", "-m", "6", "-mt", str(src), "-o", str(dst)], check=True)
        except subprocess.CalledProcessError:              # unreadable upstream PNG: keep it unchanged
            dst.unlink(missing_ok=True); dst = OUT / rel; shutil.copy2(src, dst)
            return {"orig": str(rel), "new": str(rel), "before": src.stat().st_size, "after": dst.stat().st_size, "note": "unreadable PNG kept as-is"}
    return {"orig": str(rel), "new": str(dst.relative_to(OUT)), "before": src.stat().st_size, "after": dst.stat().st_size}

def video(src: pathlib.Path) -> dict:
    rel = src.relative_to(ORIG); dst = OUT / rel; dst.parent.mkdir(parents=True, exist_ok=True)
    teaser = "teaser" in src.name
    crf = 23 if teaser else 26
    scaling = ["-vf", "scale=-2:'min(720,ih)'"] if teaser else []
    cmd = [FF, "-nostdin", "-v", "error", "-y", "-i", str(src), "-map", "0:v:0", "-map", "0:a?",
           *scaling, "-c:v", "libx264", "-preset", "slow", "-crf", str(crf),
           "-g", "32", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
           "-threads", "4", str(dst)]
    subprocess.run(cmd, check=True, stdin=subprocess.DEVNULL)
    if not teaser and dst.stat().st_size >= src.stat().st_size:
        subprocess.run([FF, "-nostdin", "-v", "error", "-y", "-i", str(src), "-map", "0", "-c", "copy",
                        "-movflags", "+faststart", str(dst)], check=True, stdin=subprocess.DEVNULL)
        return {"orig": str(rel), "new": str(rel), "before": src.stat().st_size, "after": dst.stat().st_size,
                "note": "kept the smaller source"}
    return {"orig": str(rel), "new": str(rel), "before": src.stat().st_size, "after": dst.stat().st_size,
            "params": f"H.264 CRF {crf}, " + ("up to 720p" if teaser else "source resolution")}

def copy(src: pathlib.Path) -> dict:
    rel = src.relative_to(ORIG); dst = OUT / rel; dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix == ".json":                            # minify JSON; content is unchanged
        try:
            dst.write_text(json.dumps(json.loads(src.read_bytes()), separators=(",", ":"), ensure_ascii=False))
        except ValueError:
            shutil.copy2(src, dst)
    else:
        shutil.copy2(src, dst)
    return {"orig": str(rel), "new": str(rel), "before": src.stat().st_size, "after": dst.stat().st_size}

t0 = time.time(); results = []
files = [p for p in ORIG.rglob("*") if p.is_file() and not p.name.endswith(".part")]
imgs = [p for p in files if p.parts[1] == "images"]
vids = [p for p in files if p.parts[1] == "videos"]
rest = [p for p in files if p.parts[1] not in ("images", "videos")]
with cf.ThreadPoolExecutor(12) as pool:
    results += list(pool.map(image, imgs)); results += list(pool.map(copy, rest))
print(f"images+rest done in {time.time()-t0:.0f}s", flush=True)
vids.sort(key=lambda p: -p.stat().st_size)           # biggest first
with cf.ThreadPoolExecutor(4) as pool:
    results += list(pool.map(video, vids))
json.dump(results, open("compress_manifest.json", "w"), indent=1)
by = {}
for r in results:
    k = r["orig"].split("/")[0]; b = by.setdefault(k, [0, 0, 0]); b[0] += 1; b[1] += r["before"]; b[2] += r["after"]
for k, (n, b, a) in sorted(by.items(), key=lambda x: -x[1][1]):
    print(f"{k:10s} {n:5d} files {b/1e9:6.2f} GB -> {a/1e9:6.2f} GB")
print(f"TOTAL {sum(v[1] for v in by.values())/1e9:.2f} GB -> {sum(v[2] for v in by.values())/1e9:.2f} GB in {time.time()-t0:.0f}s")
