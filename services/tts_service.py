import logging
import os
from pathlib import Path
from threading import Lock

import soundfile as sf
import torch

logger = logging.getLogger(__name__)

SUPPORTED_SPEAKERS = {
    "Vivian",
    "Serena",
    "Uncle_Fu",
    "Dylan",
    "Eric",
    "Ryan",
    "Aiden",
    "Ono_Anna",
    "Sohee",
}

VOICE_STYLE_OVERRIDES = {
    "news": "한국 뉴스 앵커처럼 또렷하고 담백하게, 속도는 약간 빠르게, 문장 끝을 분명하게 읽어줘.",
    "calm": "차분하고 신뢰감 있는 톤으로, 과장 없이 또박또박 읽어줘.",
    "warm": "부드럽고 자연스러운 톤으로, 뉴스 설명을 친절하게 전달해줘.",
    "urgent": "긴급 속보처럼 초반 호흡을 조금 빠르게, 그러나 과장하지 말고 선명하게 읽어줘."
}


def _select_device() -> str:
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class LocalTTSService:
    def __init__(self) -> None:
        self.model = None
        self.device = _select_device()
        self._load_lock = Lock()

    def load(self) -> None:
        if self.model is not None:
            return

        with self._load_lock:
            if self.model is not None:
                return

            try:
                os.environ.setdefault("NUMBA_DISABLE_JIT", "1")
                self._patch_transformers_compat()
                from qwen_tts import Qwen3TTSModel
            except ImportError as error:
                raise RuntimeError("qwen-tts 패키지가 설치되어 있지 않습니다. `pip install -U qwen-tts`를 실행해주세요.") from error

            model_id = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
            dtype = torch.float32
            logger.info("Loading local TTS model %s on %s", model_id, self.device)

            try:
                self.model = Qwen3TTSModel.from_pretrained(
                    model_id,
                    device_map=self.device,
                    dtype=dtype,
                )
            except Exception:
                if self.device != "mps":
                    logger.exception("Failed to load local TTS model")
                    raise
                logger.warning("Failed to load TTS on mps; retrying on cpu", exc_info=True)
                self.device = "cpu"
                self.model = Qwen3TTSModel.from_pretrained(
                    model_id,
                    device_map="cpu",
                    dtype=torch.float32,
                )

    def _patch_transformers_compat(self) -> None:
        try:
            import transformers.utils.generic as transformers_generic
        except Exception:
            return

        def _compat_check_model_inputs(*args, **kwargs):
            def decorator(func):
                return func

            if args and callable(args[0]) and not kwargs:
                return args[0]

            return decorator

        transformers_generic.check_model_inputs = _compat_check_model_inputs

    def generate(self, text: str, output_path: str, voice: str | None = None) -> str:
        cleaned_text = self._normalize_text(text)
        if not cleaned_text:
            raise ValueError("TTS 텍스트가 비어 있습니다.")

        self.load()
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        speaker, instruct = self._resolve_voice_profile(voice)
        try:
            return self._generate_audio(cleaned_text, speaker, instruct, output_path)
        except RuntimeError as error:
            message = str(error).lower()
            if self.device == "mps" and ("nan" in message or "inf" in message or "multinomial" in message):
                logger.warning("Retrying TTS on CPU after unstable MPS generation", exc_info=True)
                self.device = "cpu"
                self.model = None
                self.load()
                return self._generate_audio(cleaned_text, speaker, instruct, output_path)
            logger.exception("Local TTS generation failed")
            raise
        except Exception:
            logger.exception("Local TTS generation failed")
            raise

    def _generate_audio(self, text: str, speaker: str, instruct: str, output_path: str) -> str:
        wavs, sample_rate = self.model.generate_custom_voice(
            text=text,
            language="Korean",
            speaker=speaker,
            instruct=instruct,
            do_sample=False,
            max_new_tokens=1024,
        )
        sf.write(output_path, wavs[0], sample_rate)
        return output_path

    def _resolve_voice_profile(self, voice: str | None) -> tuple[str, str]:
        if not voice:
            return "Sohee", VOICE_STYLE_OVERRIDES["news"]

        normalized = voice.strip()
        if not normalized:
            return "Sohee", VOICE_STYLE_OVERRIDES["news"]

        style_key = normalized.lower()
        if style_key in VOICE_STYLE_OVERRIDES:
            return "Sohee", VOICE_STYLE_OVERRIDES[style_key]

        if normalized in SUPPORTED_SPEAKERS:
            return normalized, VOICE_STYLE_OVERRIDES["news"]

        for speaker in SUPPORTED_SPEAKERS:
            if normalized.lower() == speaker.lower():
                return speaker, VOICE_STYLE_OVERRIDES["news"]

        return "Sohee", VOICE_STYLE_OVERRIDES["news"]

    def _normalize_text(self, text: str) -> str:
        return " ".join(text.replace("\r", "\n").split())


tts_service = LocalTTSService()
