import hashlib
import unittest
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


ASSETS = Path(__file__).resolve().parents[1] / 'public/model/posewear-01'
SOURCE_SHA = 'af1325baa900b918efb1bba03d716a2a7c37f550916f29cf429c2f3abe24aab1'
ORIGINAL_LOWER_RGB_SHA = '973599f04223f71dfb8eb953dc81af73cf51129f4f83b958b0087d95c837c198'


class ModelFrontTest(unittest.TestCase):
    def test_front_is_translated_without_resampling(self):
        source_path = ASSETS / 'turnaround.png'
        self.assertEqual(hashlib.sha256(source_path.read_bytes()).hexdigest(), SOURCE_SHA)
        with Image.open(source_path) as source, Image.open(ASSETS / 'model-front.png') as canvas:
            self.assertEqual((source.size, source.mode), ((1024, 1536), 'RGB'))
            self.assertEqual(hashlib.sha256(source.crop((0, 542, 1024, 1536)).tobytes()).hexdigest(), ORIGINAL_LOWER_RGB_SHA)
            self.assertEqual(canvas.size, (1024, 1536))
            self.assertEqual(canvas.mode, 'RGB')
            original = source.crop((0, 0, 376, 1516))
            placed = canvas.crop((322, 20, 698, 1536))
            self.assertIsNone(ImageChops.difference(original, placed).getbbox())

    def test_wings_keep_the_backdrop_tones_and_join_continuously(self):
        with Image.open(ASSETS / 'model-front.png') as canvas:
            self.assertEqual(canvas.size, (1024, 1536))
            for start, end, native_edge in [(0, 322, 322), (698, 1024, 682)]:
                wing = canvas.crop((start, 0, end, canvas.height))
                self.assertTrue(all(155 <= low < high <= 205 for low, high in wing.getextrema()))
                for row in range(0, canvas.height, 32):
                    patch = ImageStat.Stat(wing.crop((0, row, wing.width, row + 32)))
                    native = ImageStat.Stat(canvas.crop((native_edge, row, native_edge + 16, row + 32)))
                    self.assertLess(max(abs(outer - inner) for outer, inner in zip(patch.mean, native.mean)), 3)
                    self.assertGreater(min(patch.stddev), 0.4)
            for seam in (322, 698):
                left = canvas.crop((seam - 1, 0, seam, canvas.height))
                right = canvas.crop((seam, 0, seam + 1, canvas.height))
                self.assertLessEqual(max(high for _, high in ImageChops.difference(left, right).getextrema()), 5)


if __name__ == '__main__':
    unittest.main()
