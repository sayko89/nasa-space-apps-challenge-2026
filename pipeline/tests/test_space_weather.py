"""build_space_weather must never write an empty archive: the app reads 'no SEP' as 'clear'."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_space_weather as bsw  # noqa: E402


class SpaceWeatherGuard(unittest.TestCase):
    def run_with(self, raw):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / 'events.json'
            src.write_text(json.dumps(raw))
            old_src, old_root = bsw.SRC, bsw.ROOT
            bsw.SRC, bsw.ROOT = src, Path(d)
            (Path(d) / 'web/public/sites/t').mkdir(parents=True)
            try:
                bsw.main(['--site', 't'])
                return json.loads((Path(d) / 'web/public/sites/t/space_weather.json').read_text())
            finally:
                bsw.SRC, bsw.ROOT = old_src, old_root

    def test_refuses_empty_or_uncovered(self):
        with self.assertRaises(SystemExit):
            self.run_with({'SEP': [], 'CME': [], 'FLR': [], 'coverage': ['2012-08-06', '2026-11-12']})
        with self.assertRaises(SystemExit):
            self.run_with({'SEP': [{'eventTime': '2024-05-11T02:00Z', 'sepID': 'x'}]})

    def test_writes_events_and_coverage(self):
        out = self.run_with({'coverage': ['2012-08-06', '2026-11-12'],
                             'SEP': [{'eventTime': '2024-05-11T02:00Z', 'sepID': 's1'}],
                             'FLR': [{'classType': 'M5.0', 'peakTime': '2024-05-10T01:00Z'},
                                     {'classType': 'X5.8', 'peakTime': '2024-05-11T01:23Z', 'flrID': 'f1'}],
                             'CME': []})
        self.assertEqual(out['coverage'], ['2012-08-06', '2026-11-12'])
        self.assertEqual(out['counts'], {'SEP': 1, 'CME': 0, 'FLR': 1})
        self.assertEqual(out['events'][0]['time'], '2024-05-11T01:23Z')


if __name__ == '__main__':
    unittest.main()
