import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 16_000_000


def normalize_image(data: bytes, *, reference: bool = True) -> Image.Image:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError("invalid_image")
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.load()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
                Image.DecompressionBombWarning, ValueError) as exc:
            raise ValueError("invalid_image") from exc
    if reference:
        image.thumbnail((1536, 1536))
    image.info.clear()
    return image
