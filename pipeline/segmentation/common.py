"""Shared definitions for the Mars terrain segmentation pipeline (AI4Mars NAV taxonomy)."""
import os, re, hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'pipeline', 'sources', 'ai4mars')          # manifests, logs, reports (committed)
WORK = os.environ.get('SEG_WORK', os.path.join(ROOT, '.seg-work'))   # prepared arrays, checkpoints (not committed)
ZIP_URL = 'https://zenodo.org/records/15995036/files/ai4mars-dataset-merged-0.6.zip?download=1'
PREFIX = 'ai4mars-dataset-merged-0.6/'

# Verified against the dataset's own label_keys.json ("NAV") and pixel values of sample masks (inventory.json)
CLASSES = ['soil', 'bedrock', 'sand', 'big_rock']
IGNORE = 255
NAV_VALUES = {0, 1, 2, 3, 255}
PALETTE = {0: (166, 124, 82), 1: (122, 74, 40), 2: (240, 178, 50), 3: (214, 48, 39), 255: (128, 128, 128)}
SIZE = 256                       # images are resized so that the shorter side is SIZE (aspect kept)
SOL_SECONDS = 88775.244

def msl_sol_group(name):
    """MSL Navcam EDR names carry the spacecraft clock (e.g. NLB_486137455EDR_…); group by Mars day."""
    m = re.match(r'N[LR][AB]_(\d{9})', os.path.basename(name))
    return f'msl-{int(m.group(1)) // int(SOL_SECONDS)}' if m else None

def m2020_sol_group(name):
    """M2020 names carry the sol after the instrument code (e.g. NLF_0147_…); HAFIQ 'Vgnc' names: first number set."""
    b = os.path.basename(name)
    m = re.match(r'[A-Z]{2,3}[A-Z_]?_(\d{4})_', b)
    if m: return f'm2020-{int(m.group(1))}'
    m = re.search(r'(\d+)', b)
    return f'm2020-v{m.group(1)}' if m else None

def base_key(name):
    """Image identity without extension, label suffixes (_merged) or M2020 duplicate markers (-1 … -4)."""
    b = os.path.splitext(os.path.basename(name))[0]
    b = re.sub(r'_merged$', '', b)
    return re.sub(r'-\d$', '', b)

def sha1(data):
    return hashlib.sha1(data).hexdigest()
