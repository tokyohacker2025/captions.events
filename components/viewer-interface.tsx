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
import { Eye, Languages, Loader2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LANGUAGES } from "@/lib/languages";
import { LanguageSelector } from "@/components/language-selector";

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

  // Translation state
  const [targetLanguage, setTargetLanguage] = useState("none");
  const [sourceLanguage, setSourceLanguage] = useState("en"); // Default to English
  const [translatedCaptions, setTranslatedCaptions] = useState<
    Map<string, string>
  >(new Map());
  const [translatedPartialText, setTranslatedPartialText] = useState("");
  const [isTranslatorSupported, setIsTranslatorSupported] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const translatorRef = useRef<Translator | null>(null);

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

  // Check if Translator API is supported
  useEffect(() => {
    if (typeof window !== "undefined" && "Translator" in self) {
      setIsTranslatorSupported(true);
    }
  }, []);

  // Create translator when target language or source language changes
  useEffect(() => {
    const createTranslator = async () => {
      // Clean up existing translator
      if (translatorRef.current) {
        translatorRef.current.destroy();
        translatorRef.current = null;
      }

      // Reset states
      setTranslationError("");
      setDownloadProgress(null);
      setTranslatedCaptions(new Map());
      setTranslatedPartialText("");

      // If no translation or not supported, return
      if (targetLanguage === "none" || !isTranslatorSupported) {
        return;
      }

      try {
        setIsTranslating(true);

        // Check availability using detected source language
        const availability = await window.Translator!.availability({
          sourceLanguage: sourceLanguage,
          targetLanguage: targetLanguage,
        });

        console.log(
          `Translator availability for ${sourceLanguage} -> ${targetLanguage}:`,
          availability
        );

        // Create the translator with download progress monitoring
        const translator = await window.Translator!.create({
          sourceLanguage: sourceLanguage,
          targetLanguage: targetLanguage,
          monitor: (m) => {
            m.addEventListener("downloadprogress", (e) => {
              const progress = Math.round(e.loaded * 100);
              console.log(`Translation model download: ${progress}%`);
              setDownloadProgress(progress);
            });
          },
        });

        translatorRef.current = translator;
        setDownloadProgress(null);

        // Translate existing captions
        await translateExistingCaptions(translator);

        setIsTranslating(false);
      } catch (error) {
        console.error("Error creating translator:", error);
        setTranslationError(
          `Failed to initialize translator: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        setIsTranslating(false);
        setDownloadProgress(null);
      }
    };

    createTranslator();

    // Cleanup on unmount or language change
    return () => {
      if (translatorRef.current) {
        translatorRef.current.destroy();
        translatorRef.current = null;
      }
    };
  }, [targetLanguage, sourceLanguage, isTranslatorSupported, captions]);

  // Function to translate existing captions
  const translateExistingCaptions = async (translator: Translator) => {
    const newTranslations = new Map<string, string>();

    for (const caption of captions) {
      try {
        const translated = await translator.translate(caption.text);
        newTranslations.set(caption.id, translated);
      } catch (error) {
        console.error(`Error translating caption ${caption.id}:`, error);
      }
    }

    setTranslatedCaptions(newTranslations);
  };

  // Translate new captions as they arrive
  useEffect(() => {
    if (
      !translatorRef.current ||
      targetLanguage === "none" ||
      captions.length === 0
    ) {
      return;
    }

    const translateNewCaption = async () => {
      const lastCaption = captions[captions.length - 1];

      // Check if we already have a translation for this caption
      if (translatedCaptions.has(lastCaption.id)) {
        return;
      }

      try {
        const translated = await translatorRef.current!.translate(
          lastCaption.text
        );
        setTranslatedCaptions((prev) => {
          const newMap = new Map(prev);
          newMap.set(lastCaption.id, translated);
          return newMap;
        });
      } catch (error) {
        console.error("Error translating new caption:", error);
      }
    };

    translateNewCaption();
  }, [captions, targetLanguage, translatedCaptions]);

  // Translate partial text with debouncing
  useEffect(() => {
    if (!translatorRef.current || targetLanguage === "none" || !partialText) {
      setTranslatedPartialText("");
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const translated = await translatorRef.current!.translate(partialText);
        setTranslatedPartialText(translated);
      } catch (error) {
        console.error("Error translating partial text:", error);
        setTranslatedPartialText("");
      }
    }, 500); // Debounce for 500ms

    return () => clearTimeout(timeoutId);
  }, [partialText, targetLanguage]);

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

          {/* Language Selector */}
          {isTranslatorSupported && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Languages className="h-4 w-4" />
                  <span>Translation:</span>
                </div>
                <div className="w-[250px]">
                  <LanguageSelector
                    value={targetLanguage}
                    onValueChange={(code) => setTargetLanguage(code || "none")}
                    disabled={isTranslating}
                    defaultOption={{
                      value: "none",
                      label: "Original (No Translation)",
                    }}
                  />
                </div>
                {isTranslating && (
                  <Badge variant="outline" className="gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {downloadProgress !== null
                      ? `Downloading model ${downloadProgress}%`
                      : "Translating..."}
                  </Badge>
                )}
              </div>
              {sourceLanguage && sourceLanguage !== "en" && (
                <div className="text-xs text-muted-foreground ml-6">
                  Detected source language: {sourceLanguage.toUpperCase()}
                </div>
              )}
            </div>
          )}

          {/* Translation Error */}
          {translationError && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{translationError}</AlertDescription>
            </Alert>
          )}

          {/* Browser Not Supported Message */}
          {!isTranslatorSupported && (
            <Alert className="mt-4">
              <AlertDescription>
                Translation is not available in your browser. Please use Chrome
                138+ with the built-in AI features enabled to access live
                translation.{" "}
                <a
                  href="https://developer.chrome.com/docs/ai/translator-api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  Learn more
                </a>
              </AlertDescription>
            </Alert>
          )}
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
                const displayText =
                  targetLanguage !== "none" &&
                  translatedCaptions.has(caption.id)
                    ? translatedCaptions.get(caption.id)!
                    : caption.text;

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
                          {LANGUAGES.find(
                            (l) => l.code === targetLanguage
                          )?.code.toUpperCase()}
                        </Badge>
                      )}
                    </div>
                    <div className="text-lg leading-relaxed">{displayText}</div>
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
                        {LANGUAGES.find(
                          (l) => l.code === targetLanguage
                        )?.code.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                  <div className="text-lg leading-relaxed italic text-primary/70">
                    {targetLanguage !== "none" && translatedPartialText
                      ? translatedPartialText
                      : partialText}
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
                href="https://elevenlabs.io/speech-to-text"
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
