import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      // If user not authenticated, return 401
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = await request.json().catch(() => null)
    if (!payload || !payload.eventUid || !payload.languageCode) {
      // If payload is invalid, return 400
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
    console.log("[Translations Debug] Request payload:", JSON.stringify(payload))
    const { eventUid, languageCode, partialText } = payload as { eventUid: string; languageCode: string; partialText?: string }

    const { data: event } = await supabase.from("events").select("id, creator_id").eq("uid", eventUid).single()
    if (!event || event.creator_id !== user.id) {
      // If user is not the event owner, return 403
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: captions } = await supabase
      .from("captions")
      .select("id,text,sequence_number,language_code")
      .eq("event_id", event.id)
      .eq("is_final", true)
      .order("sequence_number", { ascending: true })

    const { data: existingTranslations } = await supabase
      .from("translations")
      .select("caption_id")
      .eq("event_id", event.id)
      .eq("language_code", languageCode)

    const translatedSet = new Set((existingTranslations || []).map((t: { caption_id: string }) => t.caption_id))
    const pending = (captions || []).filter((c: any) => !translatedSet.has(c.id))
    console.log("[Translations Debug] Counts:", {
      captions: (captions || []).length,
      existingTranslations: (existingTranslations || []).length,
      pending: pending.length
    })
    if (pending.length === 0) {
      // If no pending captions to translate, return empty
      return NextResponse.json({ translated: [] })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      // If server not configured, return 500
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }

    const input = {
      target_language: languageCode,
      items: pending.map((c: any) => ({ caption_id: c.id, text: c.text })),
      partial_text: typeof partialText === "string" ? partialText : ""
    }

    const messages = [
      {
        role: "system",
        content:
          "Translate only the completed items to the target language. Ignore partial_text. Return a strict JSON array of objects with keys caption_id and translated_text. Do not include any extra fields or commentary."
      },
      {
        role: "user",
        content: JSON.stringify(input)
      }
    ]

    // Before calling external API: log prompt for debugging (no secrets)
    console.log("[OpenAI Debug] Prompt messages:", JSON.stringify(messages))

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0
      })
    })

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => "")
      // If OpenAI returns non-200, log raw error response
      console.log("[OpenAI Debug] Error response:", errText)
      return NextResponse.json({
        error: "OpenAI error",
        detail: errText,
        debug: { payload, pendingCount: pending.length }
      }, { status: openaiRes.status })
    }

    const openaiJson = await openaiRes.json()
    const content = openaiJson?.choices?.[0]?.message?.content || ""
    // After calling external API: log response JSON and content
    console.log("[OpenAI Debug] Response JSON:", JSON.stringify(openaiJson))
    console.log("[OpenAI Debug] Message content:", content)
    let translatedItems: Array<{ caption_id: string; translated_text: string }> = []
    try {
      translatedItems = JSON.parse(content)
      if (!Array.isArray(translatedItems)) throw new Error("Invalid JSON format")
    } catch {
      return NextResponse.json({
        error: "Invalid model output",
        debug: { payload, pendingCount: pending.length, model_output_raw: content }
      }, { status: 502 })
    }

    const sequenceById = new Map<string, number>()
    for (const c of pending) sequenceById.set(c.id, c.sequence_number)

    const rows = translatedItems.map((t) => ({
      event_id: event.id,
      caption_id: t.caption_id,
      language_code: languageCode,
      translated_text: t.translated_text,
      sequence_number: sequenceById.get(t.caption_id) || 0
    }))

    const { data: inserted, error: insertError } = await supabase
      .from("translations")
      .insert(rows)
      .select("*")
    if (insertError) {
      // If DB insert fails, return 500
      console.log("[Translations Debug] Insert error:", insertError.message)
      // Handle unique violation gracefully
      // If conflict occurs due to concurrent inserts, treat as success by re-reading inserted rows
      const conflictCodes = new Set(["23505"])
      if ((insertError as any).code && conflictCodes.has((insertError as any).code)) {
        const { data: existing } = await supabase
          .from("translations")
          .select("*")
          .eq("event_id", event.id)
          .eq("language_code", languageCode)
          .in("caption_id", rows.map((r) => r.caption_id))
          .order("sequence_number", { ascending: true })
        return NextResponse.json({
          translated: existing || [],
          debug: { prompt: messages, model_output_raw: content }
        })
      }
      return NextResponse.json(
        {
          error: "Insert error",
          detail: insertError.message,
          debug: { payload, rowsAttempted: rows.length }
        },
        { status: 500 }
      )
    }

    // Include debug fields in response for inspection
    return NextResponse.json({
      translated: inserted || [],
      debug: {
        prompt: messages,
        model_output_raw: content
      }
    })
  } catch (err: any) {
    // If unexpected error occurs, return 500
    const detail = err?.message || "Unknown error"
    console.log("[Translations Debug] Internal error:", detail)
    return NextResponse.json({ error: "Internal server error", detail }, { status: 500 })
  }
}
