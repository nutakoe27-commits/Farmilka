import torch

if not torch.cuda.is_available():
    raise SystemExit("CUDA unavailable. Check host driver and container GPU passthrough.")
properties = torch.cuda.get_device_properties(0)
print(f"torch={torch.__version__}, CUDA runtime={torch.version.cuda}")
print(f"GPU={properties.name}, VRAM={properties.total_memory / 1024**3:.1f} GiB")
tensor = torch.ones((512, 512), device="cuda", dtype=torch.bfloat16)
assert (tensor @ tensor).mean().item() == 512
print("CUDA bfloat16 matrix operation: PASS")
