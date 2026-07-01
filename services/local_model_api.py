import logging
import hashlib
import json
import os
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw

from services.image_service import image_service
from services.tts_service import tts_service

logging.basicConfig(level=os.getenv("LOCAL_MODEL_LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(os.getenv("LOCAL_MODEL_PROJECT_ROOT", Path(__file__).resolve().parents[1]))
UPLOAD_DIR = PROJECT_ROOT / "public" / "static" / "output" / "uploads"
PUBLIC_URL_PREFIX = "/static/output/uploads"
LLM_BACKEND_URL = os.getenv("LOCAL_LLM_BACKEND_URL", "http://localhost:11434/v1").rstrip("/")

app = FastAPI(title="News Shorts Local Model Service")


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1)


class ImageResponse(BaseModel):
    image_url: str
    output_path: str


class TTSRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str | None = None


class TTSResponse(BaseModel):
    audio_url: str
    output_path: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage]
    temperature: float | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "device": image_service.device, "llm_backend": LLM_BACKEND_URL}


@app.post("/images", response_model=ImageResponse)
async def generate_image(request: ImageRequest) -> ImageResponse:
    file_name = f"{uuid.uuid4().hex}.png"
    output_path = UPLOAD_DIR / file_name
    try:
        await run_in_threadpool(image_service.generate, request.prompt, str(output_path))
    except Exception as error:
        logger.exception("Image endpoint failed, using fallback art")
        try:
            create_fallback_image(request.prompt, output_path)
        except Exception as fallback_error:
            raise HTTPException(status_code=500, detail=str(fallback_error)) from fallback_error
    return ImageResponse(image_url=f"{PUBLIC_URL_PREFIX}/{file_name}", output_path=str(output_path))


@app.post("/tts", response_model=TTSResponse)
async def generate_tts(request: TTSRequest) -> TTSResponse:
    file_name = f"{uuid.uuid4().hex}.wav"
    output_path = UPLOAD_DIR / file_name
    try:
        await run_in_threadpool(tts_service.generate, request.text, str(output_path), request.voice)
    except Exception as error:
        logger.exception("TTS endpoint failed")
        raise HTTPException(status_code=500, detail=str(error)) from error
    return TTSResponse(audio_url=f"{PUBLIC_URL_PREFIX}/{file_name}", output_path=str(output_path))


@app.post("/chat")
async def generate_chat(request: ChatRequest) -> dict[str, Any]:
    try:
        return await run_in_threadpool(proxy_chat_completion, request)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Chat endpoint failed")
        raise HTTPException(status_code=500, detail=str(error)) from error


def create_fallback_image(prompt: str, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(prompt.encode("utf-8")).digest()
    width, height = 1024, 1024
    top = (digest[0], digest[1], digest[2])
    bottom = (digest[3], digest[4], digest[5])
    accent = (digest[6], digest[7], digest[8])
    soft = tuple(min(255, value + 45) for value in accent)

    image = Image.new("RGB", (width, height))
    pixels = image.load()
    for y in range(height):
        ratio = y / max(1, height - 1)
        red = int(top[0] * (1 - ratio) + bottom[0] * ratio)
        green = int(top[1] * (1 - ratio) + bottom[1] * ratio)
        blue = int(top[2] * (1 - ratio) + bottom[2] * ratio)
        for x in range(width):
            pixels[x, y] = (red, green, blue)

    draw = ImageDraw.Draw(image)
    draw.ellipse([120, 110, 540, 530], fill=accent)
    draw.ellipse([620, 140, 900, 420], fill=soft)
    draw.rounded_rectangle([120, 620, 900, 890], radius=48, fill=(255, 255, 255), outline=None)
    draw.rounded_rectangle([180, 680, 520, 820], radius=24, fill=accent)
    draw.rounded_rectangle([580, 670, 820, 820], radius=18, fill=soft)
    draw.rectangle([210, 740, 470, 754], fill=(255, 255, 255))
    draw.rectangle([210, 778, 420, 790], fill=(255, 255, 255))
    draw.polygon([(680, 900), (820, 780), (940, 920), (820, 980)], fill=soft)
    image.save(output_path, format="PNG")


def proxy_chat_completion(request: ChatRequest) -> dict[str, Any]:
    model = request.model or os.getenv("LOCAL_LLM_MODEL", "qwen3:8b")
    body = {
        "model": model,
        "messages": [message.model_dump() for message in request.messages],
        "temperature": request.temperature if request.temperature is not None else 0.2
    }
    req = Request(
        f"{LLM_BACKEND_URL}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urlopen(req, timeout=180) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=error.code, detail=detail or str(error)) from error
    except URLError as error:
        raise HTTPException(status_code=502, detail=f"LLM backend 연결 실패: {error.reason}") from error
