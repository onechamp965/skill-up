type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const DEFAULT_LOCAL_MODEL_SERVICE_URL = "http://127.0.0.1:8001";
const DEFAULT_LOCAL_LLM_MODEL = "qwen3:8b";

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function generateJsonWithOpenAI<T>(messages: ChatMessage[], fallback: () => T): Promise<T> {
  const baseUrl = (process.env.LOCAL_MODEL_SERVICE_URL || DEFAULT_LOCAL_MODEL_SERVICE_URL).replace(/\/$/, "");
  const model = process.env.LOCAL_LLM_MODEL || DEFAULT_LOCAL_LLM_MODEL;
  const response = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages
    })
  });

  if (!response.ok) {
    return fallback();
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string };
      text?: string;
    }>;
  };
  const raw = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text;
  if (!raw) {
    return fallback();
  }

  try {
    return JSON.parse(stripJsonFence(raw)) as T;
  } catch {
    return fallback();
  }
}
