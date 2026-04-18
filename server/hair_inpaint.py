"""
Mask-constrained hair inpainting pipeline.

Steps:
  1. jonathandinu/face-parsing (SegFormer) → per-pixel hair mask
  2. Dilate mask by DILATION_PX to catch stray edge pixels
  3. SD2-inpainting fills only the masked region → bald scalp appearance
  4. Composite: inpainted result pasted over original; face pixels are never touched

Because the face region is pixel-identical to the original, MediaPipe / FLAME
landmark checks will not drift, eliminating the reject-and-retry loop.
"""

import cv2
import numpy as np
import torch
from PIL import Image
from diffusers import StableDiffusionInpaintPipeline
from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

# jonathandinu/face-parsing label index for hair (CelebAMask-HQ label set)
_HAIR_LABEL = 17

DILATION_PX     = 8
INPAINT_SIZE    = 512
INPAINT_PROMPT  = "bald scalp, smooth skin, natural skin tone, realistic photo"
INPAINT_NEG     = "hair, hairline, stubble, wig, hat, cap"

_face_parser_cache: tuple | None = None
_inpaint_pipe_cache: StableDiffusionInpaintPipeline | None = None


def _face_parser():
    global _face_parser_cache
    if _face_parser_cache is None:
        proc  = SegformerImageProcessor.from_pretrained("jonathandinu/face-parsing")
        model = SegformerForSemanticSegmentation.from_pretrained("jonathandinu/face-parsing")
        model.eval()
        _face_parser_cache = (proc, model)
    return _face_parser_cache


def _inpaint_pipe(device: torch.device) -> StableDiffusionInpaintPipeline:
    global _inpaint_pipe_cache
    if _inpaint_pipe_cache is None:
        dtype = torch.float16 if device.type == "cuda" else torch.float32
        _inpaint_pipe_cache = StableDiffusionInpaintPipeline.from_pretrained(
            "stabilityai/stable-diffusion-2-inpainting",
            torch_dtype=dtype,
        ).to(device)
        _inpaint_pipe_cache.set_progress_bar_config(disable=True)
    return _inpaint_pipe_cache


def _hair_mask(image: Image.Image) -> np.ndarray:
    """Binary uint8 mask (255 = hair) at original image resolution."""
    proc, model = _face_parser()
    inputs = proc(images=image, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits          # (1, C, H/4, W/4)
    upsampled = torch.nn.functional.interpolate(
        logits,
        size=(image.height, image.width),
        mode="bilinear",
        align_corners=False,
    )
    seg = upsampled.argmax(dim=1).squeeze().numpy().astype(np.uint8)
    return (seg == _HAIR_LABEL).astype(np.uint8) * 255


def _dilate(mask: np.ndarray, px: int) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(mask, kernel)


def inpaint_hair(image_path: str, output_path: str, device: torch.device | None = None) -> str:
    """
    Removes hair from the image at image_path via inpainting.

    Writes the composite (face untouched, hair region inpainted) to output_path
    and returns output_path.
    """
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    orig   = Image.open(image_path).convert("RGB")
    W, H   = orig.size

    mask_np  = _hair_mask(orig)
    mask_np  = _dilate(mask_np, DILATION_PX)
    mask_pil = Image.fromarray(mask_np).convert("L")

    # Inpainting model expects square inputs; resize for inference only
    img_small  = orig.resize((INPAINT_SIZE, INPAINT_SIZE), Image.LANCZOS)
    mask_small = mask_pil.resize((INPAINT_SIZE, INPAINT_SIZE), Image.NEAREST)

    pipe   = _inpaint_pipe(device)
    result = pipe(
        prompt=INPAINT_PROMPT,
        negative_prompt=INPAINT_NEG,
        image=img_small,
        mask_image=mask_small,
        num_inference_steps=30,
        guidance_scale=7.5,
        strength=0.99,
    ).images[0]

    # Upscale result back to original dimensions and composite over orig
    result_full = result.resize((W, H), Image.LANCZOS)
    composite   = orig.copy()
    composite.paste(result_full, mask=mask_pil)  # only hair pixels replaced

    composite.save(output_path)
    return output_path
