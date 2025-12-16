"use client";

import { useEffect, useState, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, Languages } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LANGUAGES } from "@/lib/languages";
import { LanguageSelector } from "@/components/language-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface Event {
  id: string;
  uid: string;
  title: string;
  description: string | null;
}

interface ViewerInterfaceProps {
  event: Event;
}

interface Caption {
  id: string;
  text: string;
  timestamp: string;
  is_final: boolean;
  language_code?: string;
}

// Type definitions for Chrome Translator API
interface TranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
  monitor?: (monitor: TranslatorMonitor) => void;
}

interface TranslatorMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: TranslatorDownloadProgressEvent) => void
  ): void;
  removeEventListener(
    type: "downloadprogress",
    listener: (event: TranslatorDownloadProgressEvent) => void
  ): void;
}

interface TranslatorDownloadProgressEvent extends Event {
  loaded: number;
  total: number;
}

interface Translator {
  translate(text: string): Promise<string>;
  destroy(): void;
}

interface TranslatorConstructor {
  create(options: TranslatorCreateOptions): Promise<Translator>;
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<string>;
}

declare global {
  interface Window {
    Translator?: TranslatorConstructor;
  }
}

export function ViewerInterface({ event }: ViewerInterfaceProps) {
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [partialText, setPartialText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const supabase = getSupabaseBrowserClient();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [targetLanguage, setTargetLanguage] = useState("none");
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [translatedCaptions, setTranslatedCaptions] = useState<
    Map<string, string>
  >(new Map());
  const [eventLanguages, setEventLanguages] = useState<
    { language_code: string; is_active: boolean }[]
  >([]);
  const [viewMode, setViewMode] = useState<"original" | "translation" | "both">(
    "original"
  );
  const [inactiveNotice, setInactiveNotice] = useState(false);

  // Load existing captions on mount
  useEffect(() => {
    const loadCaptions = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("captions")
        .select("*")
        .eq("event_id", event.id)
        .eq("is_final", true)
        .order("sequence_number", { ascending: true });

      if (error) {
        console.error("Error loading captions:", error);
      } else if (data) {
        setCaptions(data);

        // Detect source language from the first caption with language_code
        if (data.length > 0) {
          const firstCaptionWithLang = data.find(
            (caption: Caption) => caption.language_code
          );
          if (firstCaptionWithLang?.language_code) {
            setSourceLanguage(firstCaptionWithLang.language_code);
            console.log(
              "Detected source language:",
              firstCaptionWithLang.language_code
            );
          }
        }

        // Scroll to bottom after initial load
        setTimeout(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop =
              scrollContainerRef.current.scrollHeight;
          }
        }, 100);
      }
      setIsLoading(false);
    };

    loadCaptions();
  }, [event.id, supabase]);

  // Subscribe to realtime updates for final captions
  useEffect(() => {
    const channel = supabase
      .channel(`captions:${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "captions",
          filter: `event_id=eq.${event.id}`,
        },
        (payload: { new: Caption }) => {
          console.log("New caption received:", payload);

          // Update source language if detected
          if (payload.new.language_code) {
            setSourceLanguage(payload.new.language_code);
          }

          // Clear partial text when final caption arrives
          setPartialText("");
          // Only add if we don't already have it (to avoid duplicates)
          setCaptions((prev) => {
            const exists = prev.some((c) => c.id === payload.new.id);
            if (exists) return prev;
            return [...prev, payload.new];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [event.id, supabase]);

  // Subscribe to broadcast channel for partial transcripts
  useEffect(() => {
    const broadcastChannel = supabase
      .channel(`broadcast:${event.uid}`)
      .on(
        "broadcast",
        { event: "partial_transcript" },
        (payload: { payload: { text: string; language_code?: string } }) => {
          console.log("Partial transcript received:", payload);

          // Update source language if detected
          if (payload.payload.language_code) {
            setSourceLanguage(payload.payload.language_code);
          }

          setPartialText(payload.payload.text);
        }
      )
      .subscribe((status: string) => {
        console.log("Broadcast channel status:", status);
      });

    return () => {
      supabase.removeChannel(broadcastChannel);
    };
  }, [event.uid, supabase]);

  useEffect(() => {
    const loadEventLanguages = async () => {
      const { data } = await supabase
        .from("event_translations")
        .select("language_code,is_active")
        .eq("event_id", event.id);
      setEventLanguages(data || []);
    };
    loadEventLanguages();
    const channel = supabase
      .channel(`event_translations:${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_translations",
          filter: `event_id=eq.${event.id}`,
        },
        () => loadEventLanguages()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [event.id, supabase]);

  useEffect(() => {
    setTranslatedCaptions(new Map());
    setInactiveNotice(false);
    if (targetLanguage === "none") return;
    const active = eventLanguages.find(
      (l) => l.language_code === targetLanguage
    )?.is_active;
    if (!active) {
      setInactiveNotice(true);
      return;
    }
    const load = async () => {
      const { data } = await supabase
        .from("translations")
        .select("caption_id, translated_text")
        .eq("event_id", event.id)
        .eq("language_code", targetLanguage)
        .order("caption_id", { ascending: true });
      const map = new Map<string, string>();
      (data || []).forEach((r: any) =>
        map.set(r.caption_id, r.translated_text)
      );
      setTranslatedCaptions(map);
    };
    load();
    const channel = supabase
      .channel(`translations:${event.id}:${targetLanguage}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "translations",
          filter: `event_id=eq.${event.id}`,
        },
        (payload: {
          new: {
            caption_id: string;
            language_code: string;
            translated_text: string;
          };
        }) => {
          if (payload.new.language_code !== targetLanguage) return;
          setTranslatedCaptions((prev) => {
            const next = new Map(prev);
            next.set(payload.new.caption_id, payload.new.translated_text);
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [event.id, supabase, targetLanguage, eventLanguages]);

  // Client-side translator removed; translations are provided via Supabase realtime

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Event Info */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-2xl">{event.title}</CardTitle>
                <Badge variant="outline" className="gap-1">
                  <Eye className="h-3 w-3" />
                  Viewer
                </Badge>
              </div>
              {event.description && (
                <CardDescription className="text-base">
                  {event.description}
                </CardDescription>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Languages className="h-4 w-4" />
                <span>Translation:</span>
              </div>
              <div className="w-full sm:w-[250px]">
                <Select
                  value={targetLanguage}
                  onValueChange={(v) => setTargetLanguage(v || "none")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      Original (No Translation)
                    </SelectItem>
                    {eventLanguages
                      .filter((l) => l.is_active)
                      .map((l) => (
                        <SelectItem
                          key={l.language_code}
                          value={l.language_code}
                        >
                          {LANGUAGES.find((x) => x.code === l.language_code)
                            ?.name || l.language_code}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={viewMode === "original" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("original")}
                >
                  Original
                </Button>
                <Button
                  variant={viewMode === "translation" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("translation")}
                >
                  Translation
                </Button>
                <Button
                  variant={viewMode === "both" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("both")}
                >
                  Both
                </Button>
              </div>
            </div>
            {inactiveNotice && targetLanguage !== "none" && (
              <Alert>
                <AlertDescription>
                  Official translation for {targetLanguage.toUpperCase()} is not
                  active.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Translation error and browser support UI removed */}
        </CardHeader>
      </Card>

      {/* Live Captions Display */}
      <Card>
        <CardHeader>
          <CardTitle>Live Captions</CardTitle>
          <CardDescription>
            Captions will appear here in real-time
            {targetLanguage !== "none" &&
              ` (translated to ${
                LANGUAGES.find((l) => l.code === targetLanguage)?.name
              })`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="bg-background border-2 rounded-lg p-8 min-h-[500px] flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
                <p className="text-sm text-muted-foreground">
                  Loading captions...
                </p>
              </div>
            </div>
          ) : captions.length === 0 && !partialText ? (
            <div className="bg-background border-2 rounded-lg p-8 min-h-[500px] flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Eye className="h-6 w-6 text-primary" />
                </div>
                <p className="text-muted-foreground font-medium">
                  Waiting for captions...
                </p>
                <p className="text-sm text-muted-foreground max-w-md">
                  Captions will appear here automatically when the broadcaster
                  starts
                </p>
              </div>
            </div>
          ) : (
            <div
              ref={scrollContainerRef}
              className="bg-background border-2 rounded-lg p-6 min-h-[500px] max-h-[600px] overflow-y-auto space-y-3"
            >
              {captions.map((caption) => {
                const timestamp = new Date(
                  caption.timestamp
                ).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                const translatedText =
                  targetLanguage !== "none"
                    ? translatedCaptions.get(caption.id) || ""
                    : "";

                return (
                  <div
                    key={caption.id}
                    className="p-3 rounded border bg-muted/30"
                  >
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
                      <span>{timestamp}</span>
                      {targetLanguage !== "none" && (
                        <Badge
                          variant="secondary"
                          className="text-xs px-1.5 py-0"
                        >
                          <Languages className="h-2.5 w-2.5 mr-1" />
                          {targetLanguage.toUpperCase()}
                        </Badge>
                      )}
                    </div>
                    {viewMode === "original" && (
                      <div className="text-lg leading-relaxed">
                        {caption.text}
                      </div>
                    )}
                    {viewMode === "translation" &&
                      targetLanguage !== "none" && (
                        <div className="text-lg leading-relaxed">
                          {translatedText || ""}
                        </div>
                      )}
                    {viewMode === "both" && targetLanguage !== "none" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="text-lg leading-relaxed">
                          {caption.text}
                        </div>
                        <div className="text-lg leading-relaxed">
                          {translatedText || ""}
                        </div>
                      </div>
                    )}
                    {viewMode === "both" && targetLanguage === "none" && (
                      <div className="text-lg leading-relaxed">
                        {caption.text}
                      </div>
                    )}
                  </div>
                );
              })}
              {partialText && (
                <div className="p-3 rounded border border-primary/20 bg-primary/5">
                  <div className="text-xs text-primary/50 mb-1 flex items-center gap-2">
                    <span>Live</span>
                    {targetLanguage !== "none" && (
                      <Badge
                        variant="secondary"
                        className="text-xs px-1.5 py-0"
                      >
                        <Languages className="h-2.5 w-2.5 mr-1" />
                        {targetLanguage.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                  <div className="text-lg leading-relaxed italic text-primary/70">
                    {partialText}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Powered By Banner */}
      <section className="container mx-auto px-4 py-12">
        <div className="flex justify-center">
          <div className="flex items-center gap-3">
            <Badge
              variant="secondary"
              className="px-4 py-2 text-sm transition-colors hover:bg-primary/10"
            >
              <span className="text-muted-foreground">Powered by</span>
              <a
                href="https://elevenlabs.io/realtime-speech-to-text"
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <span className="ml-1.5 font-semibold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent group-hover:from-purple-500 group-hover:to-blue-500 transition-all">
                  ElevenLabs Scribe
                </span>
              </a>
              <span className="text-muted-foreground">and</span>
              <a
                href="https://supabase.com/realtime"
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <span className="ml-1.5 font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent group-hover:from-emerald-500 group-hover:to-teal-500 transition-all">
                  Supabase Realtime
                </span>
              </a>
            </Badge>
          </div>
        </div>
      </section>
    </div>
  );
}
