"""FLUX.1-dev + Heartsync LoRA, with NF4 quantization of both large components."""
from PIL import Image

from .model_files import FLUX1_REPO, HEARTSYNC_REPO, LORA_FILENAME, read_manifest
from .settings import WorkerSettings


def generation_kwargs(settings: WorkerSettings, job: dict, reference: Image.Image | None) -> dict:
    kwargs = dict(prompt=job["prompt"], height=job["height"], width=job["width"],
                  num_inference_steps=settings.flux1_steps,
                  guidance_scale=settings.flux1_guidance, max_sequence_length=256)
    if reference is not None:
        kwargs.update(image=reference, strength=settings.flux1_img2img_strength)
    return kwargs


class FluxLoraEngine:
    def __init__(self, settings: WorkerSettings):
        import torch
        from diffusers import BitsAndBytesConfig, FluxImg2ImgPipeline, FluxPipeline, FluxTransformer2DModel
        from transformers import BitsAndBytesConfig as TextQuantConfig, T5EncoderModel

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable: check Docker GPU access")
        read_manifest(settings.flux1_model_dir, FLUX1_REPO)
        read_manifest(settings.heartsync_lora_dir, HEARTSYNC_REPO, marker=LORA_FILENAME)
        self.torch, self.settings = torch, settings
        quantization = dict(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                            bnb_4bit_compute_dtype=torch.bfloat16)
        transformer = FluxTransformer2DModel.from_pretrained(
            str(settings.flux1_model_dir), subfolder="transformer",
            quantization_config=BitsAndBytesConfig(**quantization),
            torch_dtype=torch.bfloat16, local_files_only=True, use_safetensors=True,
        )
        text_encoder = T5EncoderModel.from_pretrained(
            str(settings.flux1_model_dir), subfolder="text_encoder_2",
            quantization_config=TextQuantConfig(**quantization),
            dtype=torch.bfloat16, local_files_only=True, use_safetensors=True,
        )
        self.text_pipe = FluxPipeline.from_pretrained(
            str(settings.flux1_model_dir), transformer=transformer,
            text_encoder_2=text_encoder, torch_dtype=torch.bfloat16,
            local_files_only=True, use_safetensors=True,
        )
        self.text_pipe.load_lora_weights(
            str(settings.heartsync_lora_dir), weight_name=LORA_FILENAME,
            adapter_name="heartsync", local_files_only=True, use_safetensors=True,
        )
        self.text_pipe.set_adapters(["heartsync"], adapter_weights=[settings.lora_scale])
        self.text_pipe.vae.enable_tiling()
        self.image_pipe = FluxImg2ImgPipeline.from_pipe(self.text_pipe)
        self.active_pipe = None
        self._activate(self.text_pipe)

    def _activate(self, pipe):
        if self.active_pipe is pipe:
            return
        if self.active_pipe is not None:
            self.active_pipe.remove_all_hooks()
        if self.settings.model_cpu_offload:
            pipe.enable_model_cpu_offload()
        else:
            pipe.to("cuda")
        self.active_pipe = pipe

    def render(self, job: dict, reference: Image.Image | None) -> Image.Image:
        pipe = self.image_pipe if reference is not None else self.text_pipe
        self._activate(pipe)
        kwargs = generation_kwargs(self.settings, job, reference)
        kwargs["generator"] = self.torch.Generator(device="cpu").manual_seed(job["seed"])
        with self.torch.inference_mode():
            return pipe(**kwargs).images[0]
