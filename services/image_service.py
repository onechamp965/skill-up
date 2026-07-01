import gc
import logging
from threading import Lock
from pathlib import Path

import torch
from PIL import ImageStat

logger = logging.getLogger(__name__)


def _select_device() -> str:
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class LocalImageService:
    def __init__(self) -> None:
        self.pipe = None
        self.device = _select_device()
        self._load_lock = Lock()

    def load(self) -> None:
        if self.pipe is not None:
            return

        with self._load_lock:
            if self.pipe is not None:
                return

            try:
                from diffusers import AutoPipelineForText2Image, LCMScheduler
            except ImportError as error:
                raise RuntimeError(
                    "diffusers 또는 그 의존 패키지가 설치되어 있지 않습니다. "
                    "`pip install -r requirements-local-models.txt`를 실행해주세요."
                ) from error

            model_id = "runwayml/stable-diffusion-v1-5"
            lora_id = "latent-consistency/lcm-lora-sdv1-5"
            dtype = torch.float16 if self.device == "mps" else torch.float32

            logger.info("Loading local image model %s with %s on %s", model_id, lora_id, self.device)
            try:
                self.pipe = AutoPipelineForText2Image.from_pretrained(
                    model_id,
                    torch_dtype=dtype,
                    safety_checker=None,
                )
                self.pipe.scheduler = LCMScheduler.from_config(self.pipe.scheduler.config)
                self.pipe.load_lora_weights(lora_id)
                self.pipe.fuse_lora()
                self.pipe.to(self.device)
            except Exception:
                logger.exception("Failed to load local image model")
                self.pipe = None
                raise

            if hasattr(self.pipe, "enable_attention_slicing"):
                self.pipe.enable_attention_slicing()
            if hasattr(self.pipe, "enable_vae_slicing"):
                self.pipe.enable_vae_slicing()

    def generate(self, prompt: str, output_path: str) -> str:
        if not prompt.strip():
            raise ValueError("이미지 프롬프트가 비어 있습니다.")

        self.load()
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        prompt = self._prepare_prompt(prompt)

        try:
            with torch.inference_mode():
                image = self.pipe(
                    prompt=prompt,
                    negative_prompt=self._negative_prompt(),
                    width=512,
                    height=512,
                    num_inference_steps=4,
                    guidance_scale=1.5,
                ).images[0]
            image = self._ensure_visible_image(image)
            image.save(output_path)
            return output_path
        except RuntimeError as error:
            message = str(error).lower()
            if "out of memory" in message or "mps" in message or "allocation" in message:
                self.clear_cache()
                logger.warning("Retrying image generation with smaller size after memory pressure", exc_info=True)
                return self._generate_smaller(prompt, output_path)
            logger.exception("Local image generation failed")
            raise
        finally:
            self.clear_cache()

    def _generate_smaller(self, prompt: str, output_path: str) -> str:
        with torch.inference_mode():
            image = self.pipe(
                prompt=self._prepare_prompt(prompt),
                negative_prompt=self._negative_prompt(),
                width=512,
                height=512,
                num_inference_steps=4,
                guidance_scale=1.5,
            ).images[0]
        image = self._ensure_visible_image(image)
        image.save(output_path)
        return output_path

    def clear_cache(self) -> None:
        gc.collect()
        if self.device == "mps" and hasattr(torch, "mps"):
            torch.mps.empty_cache()

    def _negative_prompt(self) -> str:
        return (
            "text, letters, words, captions, subtitles, headlines, title, logo, watermark, sign, poster, "
            "label, interface text, qr code, infographic text, meme, cartoon, anime, CGI, poster layout, "
            "surreal, distorted hands, extra fingers, blurry, low quality, duplicated objects, dark image, "
            "black image, empty frame, overexposed, washed out, low contrast, copyrighted character"
        )

    def _prepare_prompt(self, prompt: str) -> str:
        cleaned = " ".join(prompt.replace("\r", " ").replace("\n", " ").split())
        cleaned = self._dedupe_clauses(cleaned, max_words=64)
        return (
            f"{cleaned}. editorial news photo, documentary realism, clear focal subject, natural light, no text, no logo"
        )

    def _ensure_visible_image(self, image):
        rgb_image = image.convert("RGB")
        stat = ImageStat.Stat(rgb_image.convert("L"))
        mean_brightness = stat.mean[0]
        contrast = stat.stddev[0]
        if mean_brightness < 48 or contrast < 10:
            raise ValueError("Generated image is too dark or low-contrast.")
        return rgb_image

    def _dedupe_clauses(self, prompt: str, max_words: int = 64) -> str:
        seen = set()
        clauses = []
        for clause in prompt.split(","):
            cleaned = clause.strip()
            if not cleaned:
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            clauses.append(cleaned)

        words = []
        for clause in clauses:
            next_words = clause.split()
            if len(words) + len(next_words) > max_words:
                break
            words.extend(next_words)
        return " ".join(words).strip()


image_service = LocalImageService()
