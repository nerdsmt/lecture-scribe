/// <reference types="@cloudflare/workers-types" />
// Lecture Scribe API: stores audio chunks in R2 and transcribes them with Workers AI Whisper.

interface Env {
  AI: Ai;
  BUCKET: R2Bucket;
  API_TOKEN: string;
}

const MODEL = "@cf/openai/whisper-large-v3-turbo";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function transcribe(env: Env, audio: ArrayBuffer, language?: string, prompt?: string) {
  const opts: Record<string, unknown> = { task: "transcribe", vad_filter: true, condition_on_previous_text: false };
  if (prompt) opts.initial_prompt = prompt.slice(0, 800); // course name + glossary biases spelling of jargon
  if (language && language !== "auto") opts.language = language;
  try {
    return (await env.AI.run(MODEL as any, { audio: toBase64(audio), ...opts })) as any;
  } catch {
    // Fallback for model versions that expect a byte array.
    return (await env.AI.run(MODEL as any, { audio: [...new Uint8Array(audio)], ...opts })) as any;
  }
}


const LLM = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

async function chat(env: Env, system: string, user: string, max = 1500): Promise<string> {
  const r: any = await env.AI.run(LLM as any, {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: max,
  });
  return String(r.response ?? "").trim();
}

// Map-reduce so long lectures (1-3h) fit the model context.
async function studyNotes(env: Env, text: string, m: any) {
  const ctx = `Course: ${m.course || "unknown"}. Lecture: ${m.title || "untitled"}. Glossary: ${m.terms || "none"}.`;
  const size = 9000;
  const segs: string[] = [];
  for (let i = 0; i < text.length; i += size) segs.push(text.slice(i, i + size));
  const partial: string[] = [];
  for (const seg of segs) {
    partial.push(await chat(env,
      `You are a study assistant. ${ctx} Clean up this raw lecture transcript segment (remove fillers, fix obvious mis-hearings using the glossary) and condense it into accurate, detailed bullet-point notes. Do not invent content that was not said.`,
      seg, 1200));
  }
  const merged = partial.join("\n").slice(0, 24000);
  const out = await chat(env,
    `You are a study assistant. ${ctx} From the lecture notes below produce Markdown with exactly these sections:\n## Summary\n(5-8 sentences)\n## Key Concepts\n(bulleted, each with a one-line definition)\n## Detailed Notes\n(organised by topic with sub-bullets)\n## Flashcards\n(8-15 lines formatted "Q: ... | A: ...")\n## Likely Exam Questions\n(5-8 questions)\n## Action Items\n(readings, deadlines, or assignments mentioned by the lecturer; "None" if absent)\nOnly use information present in the notes.`,
    merged, 3000);
  return { generatedAt: Date.now(), markdown: out };
}

function ts(sec: number) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

async function readAll(env: Env, id: string) {
  const list = await env.BUCKET.list({ prefix: `sessions/${id}/text/` });
  const chunks = [];
  for (const o of list.objects) {
    const obj = await env.BUCKET.get(o.key);
    if (obj) chunks.push(await obj.json<any>());
  }
  chunks.sort((a, b) => a.n - b.n);
  return chunks;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const auth = req.headers.get("Authorization");
    if (!env.API_TOKEN || auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean); // sessions, :id, ...
    if (parts[0] !== "sessions") return json({ error: "not found" }, 404);

    // GET /sessions
    if (parts.length === 1 && req.method === "GET") {
      const list = await env.BUCKET.list({ prefix: "sessions/", delimiter: "/" });
      const out = [];
      for (const prefix of list.delimitedPrefixes) {
        const id = prefix.split("/")[1];
        const meta = await env.BUCKET.get(`sessions/${id}/meta.json`);
        out.push(meta ? await meta.json<any>() : { id });
      }
      out.sort((a: any, b: any) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
      return json(out);
    }

    const id = parts[1];
    if (!/^[\w-]{6,64}$/.test(id ?? "")) return json({ error: "bad id" }, 400);

    // PUT /sessions/:id  (metadata: title, startedAt)
    if (parts.length === 2 && req.method === "PUT") {
      const body = await req.json<any>();
      const prev = await env.BUCKET.get(`sessions/${id}/meta.json`);
      const meta = { ...(prev ? await prev.json<any>() : {}), ...body, id };
      await env.BUCKET.put(`sessions/${id}/meta.json`, JSON.stringify(meta));
      return json(meta);
    }


    // POST /sessions/:id/notes -> AI study notes (cached in R2; ?refresh=1 to regenerate)
    if (parts[2] === "notes" && req.method === "POST") {
      const cached = await env.BUCKET.get(`sessions/${id}/notes.json`);
      if (cached && !url.searchParams.get("refresh")) return json(await cached.json());
      const chunks = await readAll(env, id);
      const full = chunks.map((c) => c.text).join(" ").trim();
      if (!full) return json({ error: "no transcript yet" }, 400);
      const metaObj = await env.BUCKET.get(`sessions/${id}/meta.json`);
      const m = metaObj ? await metaObj.json<any>() : {};
      const notes = await studyNotes(env, full, m);
      await env.BUCKET.put(`sessions/${id}/notes.json`, JSON.stringify(notes));
      return json(notes);
    }

    // GET /sessions/:id  -> full transcript
    if (parts.length === 2 && req.method === "GET") {
      const meta = await env.BUCKET.get(`sessions/${id}/meta.json`);
      const chunks = await readAll(env, id);
      const text = chunks.map((c) => `[${ts(c.offset)}] ${c.text}`.trim()).join("\n\n");
      const plain = chunks.map((c) => c.text).join(" ");
      return json({ meta: meta ? await meta.json() : { id }, text, plain, chunks: chunks.map((c) => ({ n: c.n, offset: c.offset, text: c.text })) });
    }

    // DELETE /sessions/:id
    if (parts.length === 2 && req.method === "DELETE") {
      const list = await env.BUCKET.list({ prefix: `sessions/${id}/` });
      await env.BUCKET.delete(list.objects.map((o) => o.key));
      return json({ ok: true });
    }

    // POST /sessions/:id/chunks/:n?offset=SEC&lang=en  (body = audio)
    if (parts[2] === "chunks" && parts[3] && req.method === "POST") {
      const n = parseInt(parts[3], 10);
      const offset = parseFloat(url.searchParams.get("offset") ?? "0");
      const lang = url.searchParams.get("lang") ?? undefined;
      const audio = await req.arrayBuffer();
      if (!audio.byteLength) return json({ error: "empty" }, 400);
      const pad = String(n).padStart(5, "0");
      await env.BUCKET.put(`sessions/${id}/audio/${pad}.webm`, audio, { httpMetadata: { contentType: "audio/webm" } });
      let text = "", vtt = "";
      try {
        const meta = await env.BUCKET.get(`sessions/${id}/meta.json`);
        const m = meta ? await meta.json<any>() : {};
        const prompt = [m.course && `Lecture: ${m.course}.`, m.terms && `Terms: ${m.terms}`].filter(Boolean).join(" ");
        const r = await transcribe(env, audio, lang, prompt);
        text = (r.text ?? "").trim();
        vtt = r.vtt ?? "";
      } catch (e: any) {
        return json({ error: "transcription failed", detail: String(e?.message ?? e) }, 502);
      }
      await env.BUCKET.put(`sessions/${id}/text/${pad}.json`, JSON.stringify({ n, offset, text, vtt }));
      return json({ n, text });
    }

    // GET /sessions/:id/audio  -> list;  GET /sessions/:id/audio/:n -> bytes
    if (parts[2] === "audio" && req.method === "GET") {
      if (!parts[3]) {
        const list = await env.BUCKET.list({ prefix: `sessions/${id}/audio/` });
        return json(list.objects.map((o) => ({ key: o.key.split("/").pop(), size: o.size })));
      }
      const obj = await env.BUCKET.get(`sessions/${id}/audio/${parts[3]}`);
      if (!obj) return json({ error: "not found" }, 404);
      return new Response(obj.body, { headers: { "Content-Type": "audio/webm", ...CORS } });
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
