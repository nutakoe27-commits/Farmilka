from PIL import Image, ImageDraw

from .model_files import KLEIN_REPO, read_manifest
from .settings import WorkerSettings


class MockEngine:
    """Exercises transport and the queue; this does not generate photographs."""

    def render(self, job: dict, reference: Image.Image | None) -> Image.Image:
        image = Image.new("RGB", (job["width"], job["height"]), "#1b2434")
        if reference is not None:
            thumb = reference.copy()
            thumb.thumbnail((job["width"] // 2, job["height"] // 2))
            image.paste(thumb, ((image.width - thumb.width) // 2, 100))
        draw = ImageDraw.Draw(image)
        draw.text((32, 32), "DEMO / NO GPU GENERATION", fill="white")
        draw.text((32, image.height - 48), f"Seed: {job['seed']}", fill="white")
        return image


class FluxEngine:
    def __init__(self, settings: WorkerSettings):
        import torch
        from diffusers import Flux2KleinPipeline

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable: check nvidia-smi and Docker GPU access")
        read_manifest(settings.model_dir, KLEIN_REPO)
        self.torch = torch
        self.pipe = Flux2KleinPipeline.from_pretrained(
            str(settings.model_dir), torch_dtype=torch.bfloat16,
            local_files_only=True, use_safetensors=True,
        )
        self.pipe.vae.enable_tiling()
        if settings.model_cpu_offload:
            self.pipe.enable_model_cpu_offload()
        else:
            self.pipe.to("cuda")

    def render(self, job: dict, reference: Image.Image | None) -> Image.Image:
        kwargs = {
            "prompt": job["prompt"], "height": job["height"], "width": job["width"],
            "num_inference_steps": 4, "guidance_scale": 1.0,
            "generator": self.torch.Generator(device="cpu").manual_seed(job["seed"]),
        }
        if reference is not None:
            kwargs["image"] = reference
        with self.torch.inference_mode():
            return self.pipe(**kwargs).images[0]


def build_engine(settings: WorkerSettings):
    if settings.engine == "mock":
        return MockEngine()
    if settings.engine == "flux_lora":
        from .flux_lora import FluxLoraEngine
        return FluxLoraEngine(settings)
    if settings.engine == "qwen_gguf":
        from .qwen_gguf import QwenGGUFEngine
        return QwenGGUFEngine(settings)
    if settings.engine == "lustify":
        from .lustify import LustifyEngine
        return LustifyEngine(settings)
    if settings.engine == "lustify_krea":
        from .krea import KreaEngine
        return KreaEngine(settings)
    if settings.engine == "lustify_krea_edit":
        from .krea_edit import KreaEditEngine
        return KreaEditEngine(settings)
    return FluxEngine(settings)
