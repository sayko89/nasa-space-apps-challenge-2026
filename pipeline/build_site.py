#!/usr/bin/env python3
"""
build_site.py — Martian Map veri pipeline'ı.

Gerçek bir Mars DTM'inden (varsayılan: USGS Mars 2020 TRN HiRISE DTM mozaiği,
Jezero kraterinde 1 m/piksel) bir Marswalk alanı keser ve web uygulamasının
okuduğu iki dosyayı üretir:

    <out>/<site>/grid.bin   Float32 little-endian, N×N, satır-öncelikli.
                            Satır 0 = kuzey kenarı, sütun 0 = batı kenarı.
                            Değer = yükseklik [m] (kaynak DTM'in düşey datumu).
    <out>/<site>/meta.json  Grid boyutu, hücre aralığı, merkez koordinatı,
                            projeksiyon, istatistikler ve kaynak/atıf bilgisi.
    <out>/<site>/preview.png  (Pillow kuruluysa) gölgelendirilmiş kontrol görüntüsü.

Projeksiyon notu
----------------
Kaynak DTM equirectangular, lat_ts=0 (dosya adı: ..._Eqc_latTs0_lon0_...). Bu
projeksiyonda doğu-batı ölçeği 1/cos(enlem) kadar şişer; Jezero'da (~18.4°K)
yaklaşık %5. Pencereyi doğrudan okumak doğu-batı mesafelerini büyütür, eğimleri
küçültür. Bu yüzden veri, merkez noktasında gerçek ölçekli yerel bir
equirectangular projeksiyona (lat_ts = merkez enlemi) GDAL warper ile yeniden
örneklenir. Sonuçta her grid hücresi her iki yönde de ~cell_m metredir.

Kullanım
--------
    python pipeline/build_site.py                      # Jezero, uzaktan okuma
    python pipeline/build_site.py --src JEZ_....tif    # indirilmiş dosyadan
    python pipeline/build_site.py --grid 512 --cell 4  # 512×512, 4 m → ~2 km

Uzaktan okuma GDAL /vsicurl/ ile sadece gereken byte aralıklarını çeker; dosyanın
iç düzenine göre birkaç dakika sürebilir. Çok yavaşsa dosyayı (1.8 GB) indirip
--src ile yerel yolu verin.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import os
import sys

import numpy as np


def _has_non_ascii(path: str) -> bool:
    return any(ord(ch) > 127 for ch in path)


def _ascii_safe_gdal_env() -> None:
    """
    Windows + ASCII dışı kullanıcı yolu (ör. C:\\Users\\NİTRO) düzeltmesi.

    rasterio'nun Windows paketindeki GDAL/PROJ/libcurl, site-packages altındaki
    gdal_data, proj_data ve certifi sertifika dosyasını açar. Yol ASCII dışı
    karakter içerince bu kütüphaneler dosyayı açamaz; üstelik GDAL'ın hata
    mesajı cp1254 ile kodlandığı için rasterio onu UTF-8 çözerken
    UnicodeDecodeError ile çöker ve asıl hata gizlenir.

    Çözüm: bu dosyaları bir kez ASCII bir klasöre kopyalayıp ortam
    değişkenlerini oraya yönlendirmek. rasterio import edilmeden ÖNCE
    çalışmalı: rasterio GDAL_DATA/PROJ_DATA ortam değişkenlerine öncelik verir
    ve sertifika yolunu os.environ.setdefault ile ayarlar.

    MM_FORCE_ASCII_WORKAROUND=1 → test için Windows dışında da çalıştırır.
    MM_GDAL_ENV_DIR=<yol>       → kopya klasörünü değiştirir.
    """
    import importlib.util
    import shutil

    forced = os.environ.get("MM_FORCE_ASCII_WORKAROUND") == "1"
    if os.name != "nt" and not forced:
        return

    spec = importlib.util.find_spec("rasterio")  # paketi çalıştırmadan konumunu bulur
    if spec is None or not spec.origin:
        return
    pkg_dir = os.path.dirname(spec.origin)

    sources = {}  # ortam değişkeni → (kaynak yol, hedef ad)
    for sub, env in (("gdal_data", "GDAL_DATA"), ("proj_data", "PROJ_DATA")):
        p = os.path.join(pkg_dir, sub)
        if os.path.isdir(p) and env not in os.environ and (forced or _has_non_ascii(p)):
            sources[env] = (p, sub)
    try:
        import certifi
        ca = certifi.where()
        if (os.path.isfile(ca) and "GDAL_CURL_CA_BUNDLE" not in os.environ
                and (forced or _has_non_ascii(ca))):
            sources["GDAL_CURL_CA_BUNDLE"] = (ca, "cacert.pem")
    except ImportError:
        pass

    tmp = os.environ.get("TEMP", "")
    need_tmp = "CPL_TMPDIR" not in os.environ and (forced or _has_non_ascii(tmp))
    if not sources and not need_tmp:
        return

    candidates = [os.environ.get("MM_GDAL_ENV_DIR")]
    drive = os.environ.get("SystemDrive", "C:")
    candidates += [os.path.join(drive + os.sep, "ProgramData", "martian-map", "gdal-env"),
                   os.path.join(drive + os.sep, "martian-map-gdal-env")]
    base = None
    for c in candidates:
        if not c or _has_non_ascii(c):
            continue
        try:
            os.makedirs(c, exist_ok=True)
            probe = os.path.join(c, ".write-test")
            with open(probe, "w", encoding="ascii") as f:
                f.write("ok")
            os.remove(probe)
            base = c
            break
        except OSError:
            continue
    if base is None:
        print("  ! ASCII bir çalışma klasörü oluşturulamadı. Çözüm: Python sanal ortamını "
              "ASCII bir yolda kurun (bkz. pipeline/README hata bölümü).")
        return

    for env, (src, name) in sources.items():
        dst = os.path.join(base, name)
        try:
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copyfile(src, dst)
        except OSError as e:
            print(f"  ! {name} kopyalanamadı ({e}); {env} değiştirilmedi.")
            continue
        os.environ[env] = dst
        if env == "PROJ_DATA":
            os.environ.setdefault("PROJ_LIB", dst)          # PROJ < 9.1
        if env == "GDAL_CURL_CA_BUNDLE":
            os.environ.setdefault("PROJ_CURL_CA_BUNDLE", dst)
            os.environ.setdefault("CURL_CA_BUNDLE", dst)
    if need_tmp:
        t = os.path.join(base, "tmp")
        os.makedirs(t, exist_ok=True)
        os.environ["CPL_TMPDIR"] = t
    # Kimlik doğrulama gerekmiyor; curl'ün ~/.netrc aramasını kapat (ev dizini de ASCII dışı)
    os.environ.setdefault("GDAL_HTTP_NETRC", "NO")
    print(f"  ASCII dışı yol algılandı → GDAL/PROJ/sertifika dosyaları {base} altından kullanılıyor")


_ascii_safe_gdal_env()

try:
    import rasterio
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.fill import fillnodata
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT
    from rasterio.warp import transform as warp_transform
except ImportError:  # pragma: no cover
    sys.exit("rasterio gerekli: pip install -r pipeline/requirements.txt")

# Mars referans küresi (USGS ürün sayfası: radius A = C = 3,396,190 m)
MARS_RADIUS_M = 3_396_190.0

# Doğrulanmış site ön ayarları. Her değer kaynağıyla birlikte tutulur.
SITE_PRESETS = {
    "jezero": {
        "label": "Jezero Crater — Octavia E. Butler Landing",
        # Perseverance iniş noktası, 18.44°K 77.45°D
        # Kaynak: NASA GISS Mars24, "Mars Lander Missions"
        # https://www.giss.nasa.gov/tools/mars24/help/landers.html
        "lat": 18.44,
        "lon": 77.45,
        "center_source": "NASA GISS Mars24 — Mars Lander Missions "
                         "(https://www.giss.nasa.gov/tools/mars24/help/landers.html)",
        "src": "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/"
               "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif",
        "dataset": {
            "title": "Mars 2020 Terrain Relative Navigation HiRISE DTM Mosaic",
            "publisher": "USGS Astrogeology Science Center",
            "doi": "https://doi.org/10.5066/P9REJ9JN",
            "page": "https://astrogeology.usgs.gov/search/map/"
                    "mars_2020_terrain_relative_navigation_hirise_dtm_mosaic",
            "citation": "Fergason, R. L., Hare, T. M., Mayer, D. P., Galuszka, D. M., "
                        "Redding, B. L., Smith, E. D., Shinaman, J. R., Cheng, Y., "
                        "Otero, R. E. (2020). Mars 2020 Terrain Relative Navigation "
                        "Flight Product Generation: Digital Terrain Model and "
                        "Orthorectified Image Mosaics. 51st LPSC.",
            "instrument": "MRO HiRISE stereo DTM (dosya adına göre MOLA topografyasına bağlanmış)",
            "native_resolution_m": 1.0,
        },
    },
}

# Uzaktan GeoTIFF okumasını hızlandıran GDAL ayarları
GDAL_REMOTE_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff",
    GDAL_HTTP_MULTIRANGE="YES",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    GDAL_HTTP_MAX_RETRY="5",
    GDAL_HTTP_RETRY_DELAY="2",
    VSI_CACHE="TRUE",
    VSI_CACHE_SIZE=str(256 * 1024 * 1024),
)

MAX_NODATA_FRACTION = 0.05  # bundan fazla boşluk varsa merkezi kaydırmak gerekir


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Mars DTM → Martian Map site grid")
    p.add_argument("--site", default="jezero", help="site adı (çıktı klasörü)")
    p.add_argument("--src", default=None,
                   help="DTM GeoTIFF yolu veya URL (varsayılan: site ön ayarı)")
    p.add_argument("--lat", type=float, default=None, help="merkez enlemi [°K, planetosentrik]")
    p.add_argument("--lon", type=float, default=None, help="merkez boylamı [°D]")
    p.add_argument("--grid", type=int, default=512, help="grid düğüm sayısı N (N×N)")
    p.add_argument("--cell", type=float, default=4.0, help="düğüm aralığı [m]")
    p.add_argument("--out", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..",
        "artifacts", "moon-rover", "public", "sites"),
        help="çıktı kök klasörü")
    p.add_argument("--allow-nodata", type=float, default=MAX_NODATA_FRACTION,
                   help="izin verilen en büyük boş piksel oranı (0-1)")
    return p.parse_args(argv)


def source_radius(crs: CRS | None) -> float:
    """Kaynak CRS'in küre yarıçapını bulmaya çalışır; bulamazsa Mars referansı."""
    if crs is None:
        return MARS_RADIUS_M
    try:
        d = crs.to_dict()
        for k in ("R", "a"):
            if k in d:
                return float(d[k])
    except Exception:  # noqa: BLE001 — CRS sözlüğe çevrilemezse varsayılana düş
        pass
    return MARS_RADIUS_M


def local_crs(lat0: float, lon0: float, radius: float) -> CRS:
    """Merkezde gerçek ölçekli yerel equirectangular projeksiyon."""
    return CRS.from_proj4(
        f"+proj=eqc +lat_ts={lat0} +lat_0={lat0} +lon_0={lon0} "
        f"+x_0=0 +y_0=0 +R={radius} +units=m +no_defs"
    )


def to_gdal_path(src: str) -> str:
    if src.startswith(("http://", "https://")):
        return "/vsicurl/" + src
    return src


def hillshade(z: np.ndarray, cell: float, az_deg=315.0, alt_deg=35.0) -> np.ndarray:
    gy, gx = np.gradient(z, cell)          # gy: satır yönü (güney), gx: doğu
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(az_deg), math.radians(alt_deg)
    hs = (np.sin(alt) * np.cos(slope)
          + np.cos(alt) * np.sin(slope) * np.cos(az - aspect))
    return np.clip(hs, 0, 1)


def build(args) -> dict:
    preset = SITE_PRESETS.get(args.site, {})
    src = args.src or preset.get("src")
    lat0 = args.lat if args.lat is not None else preset.get("lat")
    lon0 = args.lon if args.lon is not None else preset.get("lon")
    if src is None or lat0 is None or lon0 is None:
        sys.exit(f"'{args.site}' için ön ayar yok: --src, --lat ve --lon verin.")
    if args.grid < 16 or args.cell <= 0:
        sys.exit("--grid en az 16, --cell pozitif olmalı.")

    n, cell = args.grid, args.cell
    span = (n - 1) * cell                   # düğümden düğüme genişlik
    remote = src.startswith(("http://", "https://"))
    print(f"[1/5] Kaynak açılıyor ({'uzaktan' if remote else 'yerel'}): {src}")

    env = GDAL_REMOTE_ENV if remote else {}
    with rasterio.Env(**env):
        with rasterio.open(to_gdal_path(src)) as ds:
            if ds.crs is None:
                sys.exit("Kaynakta CRS yok; projeksiyon bilinmeden ölçek doğrulanamaz.")
            radius = source_radius(ds.crs)
            if abs(radius - MARS_RADIUS_M) > 1.0:
                print(f"  ! Kaynak yarıçapı {radius:.0f} m (beklenen {MARS_RADIUS_M:.0f} m)")
            print(f"  boyut {ds.width}×{ds.height}, piksel {ds.res[0]:.3f}×{ds.res[1]:.3f}, "
                  f"nodata={ds.nodata}")

            # Merkez noktası kaynak kapsamında mı?
            geo = CRS.from_proj4(f"+proj=longlat +R={radius} +no_defs")
            xs, ys = warp_transform(geo, ds.crs, [lon0], [lat0])
            b = ds.bounds
            if not (b.left <= xs[0] <= b.right and b.bottom <= ys[0] <= b.top):
                sys.exit(f"Merkez ({lat0}°K, {lon0}°D) DTM kapsamı dışında: {b}")

            # Hedef grid: merkez (0,0); düğüm i'nin x'i = -span/2 + i*cell.
            # Piksel-alan (pixel-is-area) gösteriminde sol-üst köşe yarım hücre dışarıda.
            dst_crs = local_crs(lat0, lon0, radius)
            half = span / 2.0
            dst_transform = from_origin(-half - cell / 2.0, half + cell / 2.0, cell, cell)

            print(f"[2/5] Yerel projeksiyona örnekleniyor: {n}×{n}, {cell} m "
                  f"(~{span:.0f} m × {span:.0f} m) — average resampling")
            with WarpedVRT(ds, crs=dst_crs, transform=dst_transform, width=n, height=n,
                           resampling=Resampling.average,
                           src_nodata=ds.nodata, nodata=ds.nodata) as vrt:
                band = vrt.read(1, masked=True).astype(np.float64)

    valid = ~np.ma.getmaskarray(band)
    z = np.ma.getdata(band).astype(np.float32)
    nodata_frac = 1.0 - valid.mean()
    print(f"[3/5] Boş piksel oranı: {nodata_frac * 100:.2f}%")
    if nodata_frac > args.allow_nodata:
        sys.exit(f"Boş piksel oranı %{nodata_frac * 100:.1f} > izin verilen "
                 f"%{args.allow_nodata * 100:.1f}. Merkezi DTM içine kaydırın veya alanı küçültün.")
    filled = int((~valid).sum())
    if filled:
        z = fillnodata(z, mask=valid.astype(np.uint8), max_search_distance=max(16, n // 8))
        if not np.isfinite(z).all():
            sys.exit("Boşluk doldurma başarısız (sonsuz değer kaldı).")

    gy, gx = np.gradient(z.astype(np.float64), cell)
    slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))

    out_dir = os.path.abspath(os.path.join(args.out, args.site))
    os.makedirs(out_dir, exist_ok=True)
    grid_path = os.path.join(out_dir, "grid.bin")
    print(f"[4/5] Yazılıyor: {grid_path}")
    z.astype("<f4").tofile(grid_path)

    meta = {
        "format": "martian-map-site/1",
        "site": args.site,
        "label": preset.get("label", args.site),
        "grid": {
            "n": n,
            "cell_m": cell,
            "span_m": span,
            "dtype": "float32-le",
            "order": "row-major; row 0 = north edge, col 0 = west edge",
            "world_axes": "x = east [m], z = south [m], origin = center",
        },
        "center": {
            "lat_deg": lat0,
            "lon_deg_east": lon0,
            "source": preset.get("center_source", "kullanıcı girdisi"),
        },
        "projection": {
            "proj4": dst_crs.to_proj4(),
            "note": "Kaynak eqc(lat_ts=0) verisi merkezde gerçek ölçekli yerel eqc'ye yeniden örneklendi.",
            "mars_radius_m": radius,
        },
        "elevation_m": {
            "min": float(z.min()),
            "max": float(z.max()),
            "median": float(np.median(z)),
            "datum": "kaynak DTM ile aynı (değiştirilmedi)",
        },
        "slope_deg": {
            "mean": float(slope_deg.mean()),
            "p95": float(np.percentile(slope_deg, 95)),
            "max": float(slope_deg.max()),
            "note": f"{cell} m grid üzerinde merkezi fark; 1 m altı engebe görünmez.",
        },
        "nodata_filled_cells": filled,
        "source": {"url": src, **preset.get("dataset", {})},
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "generator": "pipeline/build_site.py",
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    try:
        from PIL import Image
        hs = hillshade(z.astype(np.float64), cell)
        Image.fromarray((hs * 255).astype(np.uint8)).save(os.path.join(out_dir, "preview.png"))
        print("[5/5] preview.png yazıldı")
    except ImportError:
        print("[5/5] Pillow yok, preview.png atlandı")

    print(f"Tamam. Yükseklik {meta['elevation_m']['min']:.1f}…{meta['elevation_m']['max']:.1f} m, "
          f"eğim ort. {meta['slope_deg']['mean']:.1f}°, p95 {meta['slope_deg']['p95']:.1f}°")
    return meta


def main(argv=None):
    try:
        build(parse_args(argv))
    except UnicodeDecodeError:
        # GDAL'ın cp1254 kodlu hata mesajını rasterio UTF-8 çözemedi: asıl hata
        # gizlendi. Neredeyse her zaman ASCII dışı bir dosya yolundan kaynaklanır.
        sys.exit(
            "\nGDAL bir hata verdi ama mesajı okunamadı (Windows + ASCII dışı yol, ör. 'NİTRO').\n"
            "Çözüm: sanal ortamı ASCII bir klasörde kurup oradan çalıştırın:\n"
            "  py -m venv C:\\mmvenv\n"
            "  C:\\mmvenv\\Scripts\\python -m pip install -r pipeline\\requirements.txt\n"
            "  C:\\mmvenv\\Scripts\\python pipeline\\build_site.py\n"
            "Hâlâ olursa dosyayı tarayıcıdan indirip --src ile ASCII bir yoldan verin "
            "(ör. C:\\mmdata\\jezero_dtm.tif)."
        )


if __name__ == "__main__":
    main()
