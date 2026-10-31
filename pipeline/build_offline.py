#!/usr/bin/env python3
"""
build_offline.py — rebuilds MartianMap/app, the compiled app that runs offline.

People download the repository and open it with MartianMap/Start-Windows.bat; this folder
is kept ready in the repo. After changing the app code or public/sites data, run this and
commit MartianMap/app:

  pnpm install            # once
  python pipeline/build_offline.py
  git add MartianMap && git commit -m "build: refresh offline package"

A relative base path (BASE_PATH=./) is used so data files and the Web Worker are found
wherever app/ is served from.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP_SRC = os.path.join(ROOT, "artifacts", "moon-rover")
OUT = os.path.join(ROOT, "MartianMap", "app")


def main():
    env = {**os.environ, "BASE_PATH": "./", "NODE_ENV": "production"}
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    cmd = ["pnpm", "exec", "vite", "build", "--config", "vite.config.ts", "--outDir", OUT, "--emptyOutDir"]
    print("[1/2]", " ".join(cmd))
    r = subprocess.run(cmd, cwd=APP_SRC, env=env, shell=(os.name == "nt"))
    if r.returncode != 0:
        sys.exit("Build failed — did you run 'pnpm install' first?")
    for need in ("index.html", os.path.join("sites", "jezero", "grid.bin")):
        if not os.path.exists(os.path.join(OUT, need)):
            sys.exit(f"Missing output: {need}")
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print(f"[2/2] Ready: {OUT} ({size / 1e6:.1f} MB). Run: MartianMap/Start-Windows.bat")


if __name__ == "__main__":
    main()
