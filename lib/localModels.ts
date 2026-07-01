type LocalImageResponse = {
  image_url?: string;
  output_path?: string;
  error?: string;
};

type LocalTTSResponse = {
  audio_url?: string;
  output_path?: string;
  error?: string;
};

type LocalModelError = {
  detail?: unknown;
  error?: string;
};

const DEFAULT_LOCAL_MODEL_SERVICE_URL = "http://127.0.0.1:8001";

function getLocalModelServiceUrl() {
  return (process.env.LOCAL_MODEL_SERVICE_URL || DEFAULT_LOCAL_MODEL_SERVICE_URL).replace(/\/$/, "");
}

async function postLocalModel<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getLocalModelServiceUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  const payload: T & LocalModelError = raw ? (JSON.parse(raw) as T & LocalModelError) : ({} as T & LocalModelError);

  if (!response.ok) {
    throw new Error(formatLocalModelError(payload, raw));
  }

  return payload;
}

function formatLocalModelError(payload: LocalModelError, raw: string) {
  if (payload.error) return payload.error;
  if (typeof payload.detail === "string") return payload.detail;
  if (payload.detail) return JSON.stringify(payload.detail);
  return raw || "로컬 모델 서비스 요청에 실패했습니다.";
}

export async function generateImageWithLocalModel(prompt: string) {
  const payload = await postLocalModel<LocalImageResponse>("/images", { prompt });
  if (!payload.image_url) {
    throw new Error(payload.error || "로컬 이미지 생성 결과가 비어 있습니다.");
  }
  return payload.image_url;
}

export async function generateSpeechWithLocalModel(text: string, voice?: string) {
  const payload = await postLocalModel<LocalTTSResponse>("/tts", { text, voice });
  if (!payload.audio_url) {
    throw new Error(payload.error || "로컬 TTS 생성 결과가 비어 있습니다.");
  }
  return payload.audio_url;
}
