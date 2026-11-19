/**
 * The one thing the app needs from a language model: text in, text out.
 * The service depends on this interface, so tests pass a fake and nothing
 * outside this folder knows which provider is behind it.
 */
export interface ModelClient {
  generate(prompt: string, signal: AbortSignal): Promise<string>;
}

export class ModelError extends Error {}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Google Gemini over its REST API. No SDK: one POST, one field read from the answer. */
export class GeminiClient implements ModelClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async generate(prompt: string, signal: AbortSignal): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      // The key goes in a header, not the URL, so it does not end up in access logs.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
      signal,
    });
    if (!response.ok) throw new ModelError(`Model provider answered HTTP ${response.status}`);
    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw new ModelError('Model answer had no text');
    return text;
  }
}
