"""Check NF4 kernels and PEFT on a tiny model before downloading base weights."""
import bitsandbytes as bnb
import peft
import torch
from peft import LoraConfig, get_peft_model

if not torch.cuda.is_available():
    raise SystemExit("CUDA unavailable")


class Tiny(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = bnb.nn.Linear4bit(
            64, 64, bias=False, compute_dtype=torch.bfloat16, quant_type="nf4",
        )

    def forward(self, value):
        return self.linear(value)


tiny = Tiny().to("cuda")
assert tiny.linear.weight.quant_state is not None, "Weights were not quantized"
model = get_peft_model(tiny, LoraConfig(r=4, lora_alpha=4, target_modules=["linear"]))
value = torch.ones((2, 64), device="cuda", dtype=torch.bfloat16)
with torch.inference_mode():
    result = model(value)
assert result.shape == (2, 64) and bool(torch.isfinite(result).all())
print(f"torch={torch.__version__}, bitsandbytes={bnb.__version__}, peft={peft.__version__}")
print("NF4 + LoRA CUDA operation: PASS")
