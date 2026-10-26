#!/usr/bin/env python3
"""
build_offline.py — MartianMap/app klasörünü (çevrimdışı çalışan derlenmiş uygulama) yeniden üretir.

Arkadaşlar repoyu indirip MartianMap/Baslat-Windows.bat ile açar; bu klasör repoda
hazır durur. Uygulama kodu veya public/sites verisi değişince bunu çalıştırıp
MartianMap/app'i commit edin:

  pnpm install            # bir kez
  python pipeline/build_offline.py
  git add MartianMap && git commit -m "build: refresh offline package"

Göreli taban yolu (BASE_PATH=./) kullanılır; böylece app/ hangi adreste sunulursa
sunulsun veri dosyaları ve Web Worker bulunur.
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
        sys.exit("Derleme başarısız — önce 'pnpm install' çalıştırdınız mı?")
    for need in ("index.html", os.path.join("sites", "jezero", "grid.bin")):
        if not os.path.exists(os.path.join(OUT, need)):
            sys.exit(f"Eksik çıktı: {need}")
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print(f"[2/2] Hazır: {OUT} ({size / 1e6:.1f} MB). Çalıştırma: MartianMap/Baslat-Windows.bat")


if __name__ == "__main__":
    main()
