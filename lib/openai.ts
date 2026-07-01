type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function generateJsonWithOpenAI<T>(messages: ChatMessage[], fallback: () => T): Promise<T> {
  if (!process.env.OPENAI_API_KEY) {
    return fallback();
  }

  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages
    })
  });

  if (!response.ok) {
    return fallback();
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) {
    return fallback();
  }

  try {
    return JSON.parse(stripJsonFence(raw)) as T;
  } catch {
    return fallback();
  }
}

export async function generateImageWithOpenAI(prompt: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 이미지 생성을 건너뜁니다.");
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1024x1536",
      n: 1
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(formatOpenAIError(message, "이미지 생성에 실패했습니다."));
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const image = payload.data?.[0];
  if (image?.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  if (image?.url) {
    return image.url;
  }
  throw new Error("이미지 결과가 비어 있습니다.");
}

export async function generateSpeechWithOpenAI(narration: string, voice = "alloy") {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 음성 생성을 건너뜁니다.");
  }

  const input = narration.trim();
  if (!input) {
    throw new Error("TTS 입력 텍스트가 비어 있습니다.");
  }

  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      voice,
      input,
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(formatOpenAIError(message, "음성 생성에 실패했습니다."));
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function formatOpenAIError(message: string, fallback: string) {
  if (!message) return fallback;
  try {
    const payload = JSON.parse(message) as { error?: { code?: string; message?: string; type?: string } };
    const code = payload.error?.code;
    const detail = payload.error?.message || message;
    if (code === "insufficient_quota" || detail.includes("quota")) {
      return "OpenAI API 크레딧 또는 결제 한도를 초과했습니다. OpenAI Billing에서 크레딧/결제수단을 확인하거나 새 API 키를 넣어주세요.";
    }
    if (code === "invalid_api_key" || detail.includes("Incorrect API key")) {
      return "OpenAI API 키가 올바르지 않습니다. .env.local 또는 Vercel 환경변수의 OPENAI_API_KEY를 확인해주세요.";
    }
    return detail;
  } catch {
    if (message.includes("quota")) {
      return "OpenAI API 크레딧 또는 결제 한도를 초과했습니다. OpenAI Billing에서 크레딧/결제수단을 확인하거나 새 API 키를 넣어주세요.";
    }
    return message;
  }
}
