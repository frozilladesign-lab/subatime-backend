import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Google AI Gemini REST client (Generative Language API).
 * Set GEMINI_API_KEY in the environment — never commit keys.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('GEMINI_API_KEY')?.trim();
  }

  /**
   * @see https://ai.google.dev/api/rest/v1beta/models/generateContent
   */
  async generateContent(systemInstruction: string, userMessage: string): Promise<string> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const model =
      this.config.get<string>('GEMINI_MODEL')?.trim() || 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const body: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
    };

    let res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    // Some API versions reject systemInstruction; retry as a single user turn.
    if (!res.ok && res.status === 400) {
      const merged = `${systemInstruction}\n\n---\n\nUser question:\n${userMessage}`;
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: merged }] }],
        }),
      });
    }

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.warn(`Gemini HTTP ${res.status}: ${errBody.slice(0, 800)}`);
      throw new Error(`Gemini request failed (${res.status})`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      error?: { message?: string };
    };

    if (data.error?.message) {
      throw new Error(data.error.message);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      const reason = data.candidates?.[0]?.finishReason ?? 'unknown';
      throw new Error(`Gemini returned no text (finish: ${reason})`);
    }

    return text;
  }

  /**
   * Multimodal: chart screenshot / PDF raster preview — extract hints only; user must confirm fields.
   */
  async generateContentWithImage(
    systemInstruction: string,
    userMessage: string,
    imageBase64: string,
    mimeType: string,
  ): Promise<string> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const clean = imageBase64.replace(/^data:[^;]+;base64,/i, '').trim();
    if (clean.length < 100) {
      throw new Error('image payload too small');
    }
    if (clean.length > 5_500_000) {
      throw new Error('image payload too large');
    }

    const model =
      this.config.get<string>('GEMINI_MODEL')?.trim() || 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: userMessage },
      { inlineData: { mimeType, data: clean } },
    ];

    const body: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [{ role: 'user', parts }],
    };

    let res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok && res.status === 400) {
      const merged = `${systemInstruction}\n\n---\n\n${userMessage}`;
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: merged }, parts[1]] }],
        }),
      });
    }

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.warn(`Gemini multimodal HTTP ${res.status}: ${errBody.slice(0, 800)}`);
      throw new Error(`Gemini request failed (${res.status})`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      error?: { message?: string };
    };

    if (data.error?.message) {
      throw new Error(data.error.message);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      const reason = data.candidates?.[0]?.finishReason ?? 'unknown';
      throw new Error(`Gemini returned no text (finish: ${reason})`);
    }

    return text;
  }
}
