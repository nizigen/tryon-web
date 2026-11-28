import argparse
import hashlib
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps


ASSETS = Path(__file__).resolve().parents[1] / 'public/model/posewear-01'
SOURCE_SHA = 'af1325baa900b918efb1bba03d716a2a7c37f550916f29cf429c2f3abe24aab1'
OUTPUT = ASSETS / 'model-front.png'


def backdrop_wing(edge, swatch, width):
    tone = edge.resize((1, edge.height), Image.Resampling.BOX).filter(ImageFilter.GaussianBlur(28))
    grain = ImageChops.subtract(swatch, swatch.filter(ImageFilter.GaussianBlur(12)), offset=128)
    texture = Image.new('RGB', (width, edge.height))
    for row, top in enumerate(range(0, texture.height, grain.height)):
        tile = ImageOps.flip(grain) if row % 2 else grain
        for column, left in enumerate(range(0, texture.width, grain.width)):
            texture.paste(ImageOps.mirror(tile) if column % 2 else tile, (left, top))
    wing = ImageChops.add(tone.resize(texture.size, Image.Resampling.NEAREST), texture, offset=-128)
    fade = bytes(round(255 * (1 - offset / (edge.width - 1))) for offset in range(edge.width))
    mask = Image.frombytes('L', (edge.width, 1), fade).resize(edge.size, Image.Resampling.NEAREST)
    wing.paste(edge, (0, 0), mask)
    return wing


def compose(source):
    front = source.crop((0, 0, 376, source.height))
    left = backdrop_wing(front.crop((0, 0, 16, front.height)), front.crop((0, 960, 72, 1360)), 322)
    right_edge = ImageOps.mirror(front.crop((360, 0, 376, front.height)))
    right = backdrop_wing(right_edge, front.crop((304, 960, 376, 1360)), 326)
    canvas = Image.new('RGB', source.size)
    canvas.paste(ImageOps.mirror(left), (0, 20))
    canvas.paste(front, (322, 20))
    canvas.paste(right, (698, 20))
    canvas.paste(ImageOps.flip(canvas.crop((0, 20, canvas.width, 40))), (0, 0))
    return canvas


def main():
    parser = argparse.ArgumentParser(description='Rebuild the default portrait from the pinned turnaround.')
    parser.add_argument('--check', action='store_true', help='compare without writing the PNG')
    args = parser.parse_args()
    original = (ASSETS / 'turnaround.png').read_bytes()
    if hashlib.sha256(original).hexdigest() != SOURCE_SHA:
        raise SystemExit('Source SHA-256 changed; review the front and backdrop coordinates before rebuilding.')
    with Image.open(BytesIO(original)) as source, BytesIO() as encoded:
        compose(source).save(encoded, 'PNG', compress_level=9)
        result = encoded.getvalue()
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_bytes() != result:
            raise SystemExit('model-front.png differs from the reconstruction.')
    else:
        OUTPUT.write_bytes(result)
    print(f'{hashlib.sha256(result).hexdigest()}  {OUTPUT.name}')


if __name__ == '__main__':
    main()
