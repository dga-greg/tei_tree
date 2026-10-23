import type { Logger } from '../core/logger.js';

export interface TranscriptionResult {
  text: string;
  /** Language the service detected, when it says. */
  language?: string;
}

export interface Transcriber {
  readonly enabled: boolean;
  readonly maxBytes: number;
  /** Transcribes a recording; with `translate`, returns an English translation instead. */
  transcribe(file: Buffer, filename: string, mimeType: string, translate: boolean): Promise<TranscriptionResult>;
}

/**
 * An OpenAI-compatible speech-to-text endpoint (`…/audio/transcriptions`; translations into English at
 * `…/audio/translations`): OpenAI's Whisper, or self-hosted servers that speak the same API.
 */
export class HttpTranscriber implements Transcriber {
  readonly enabled = true;

  constructor(
    private readonly url: string,
    private readonly apiKey: string | undefined,
    private readonly model: string,
    readonly maxBytes: number,
    private readonly logger: Logger,
  ) {}

  async transcribe(file: Buffer, filename: string, mimeType: string, translate: boolean): Promise<TranscriptionResult> {
    const endpoint = translate ? this.url.replace(/transcriptions\/?$/, 'translations') : this.url;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type: mimeType }), filename || 'recording');
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      this.logger.warn({ status: res.status, detail }, 'Transcription service refused the recording');
      throw new Error(res.status === 413 ? 'The recording is too large for the transcription service' : `The transcription service answered ${res.status}`);
    }
    const body = (await res.json()) as { text?: string; language?: string };
    return { text: (body.text ?? '').trim(), ...(body.language ? { language: body.language } : {}) };
  }
}

export class DisabledTranscriber implements Transcriber {
  readonly enabled = false;
  readonly maxBytes = 0;
  async transcribe(): Promise<TranscriptionResult> {
    throw new Error('Automatic transcription is not set up');
  }
}

export function transcriberFromEnv(env: { TRANSCRIPTION_URL?: string; TRANSCRIPTION_API_KEY?: string; TRANSCRIPTION_MODEL: string; TRANSCRIPTION_MAX_MB: number }, logger: Logger): Transcriber {
  return env.TRANSCRIPTION_URL ? new HttpTranscriber(env.TRANSCRIPTION_URL, env.TRANSCRIPTION_API_KEY, env.TRANSCRIPTION_MODEL, env.TRANSCRIPTION_MAX_MB * 1024 * 1024, logger) : new DisabledTranscriber();
}
