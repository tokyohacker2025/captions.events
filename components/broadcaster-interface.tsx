"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  Check,
  ExternalLink,
  Radio,
  Mic,
  MicOff,
  AlertCircle,
  Languages,
} from "lucide-react";
import Link from "next/link";
import { useScribe } from "@elevenlabs/react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LanguageSelector } from "@/components/language-selector";

interface Event {
  id: string;
  uid: string;
  title: string;
  description: string | null;
}

interface BroadcasterInterfaceProps {
  event: Event;
  viewerUrl: string;
}

interface Caption {
  id: string;
  text: string;
  timestamp: string;
  is_final: boolean;
  language_code?: string;
}

// Type definitions for Chrome Language Detector API
interface LanguageDetectorCreateOptions {
  monitor?: (monitor: LanguageDetectorMonitor) => void;
}

interface LanguageDetectorMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: LanguageDetectorDownloadProgressEvent) => void
  ): void;
  removeEventListener(
    type: "downloadprogress",
    listener: (event: LanguageDetectorDownloadProgressEvent) => void
  ): void;
}

interface LanguageDetectorDownloadProgressEvent extends Event {
  loaded: number;
  total: number;
}

interface LanguageDetectionResult {
  detectedLanguage: string;
  confidence: number;
}

interface LanguageDetector {
  detect(text: string): Promise<LanguageDetectionResult[]>;
}

interface LanguageDetectorConstructor {
  create(options?: LanguageDetectorCreateOptions): Promise<LanguageDetector>;
  availability(): Promise<string>;
}

declare global {
  interface Window {
    LanguageDetector?: LanguageDetectorConstructor;
  }
}

export function BroadcasterInterface({
  event,
  viewerUrl,
}: BroadcasterInterfaceProps) {
  const [copied, setCopied] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [partialText, setPartialText] = useState("");
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const sequenceNumberRef = useRef(0);
  const supabase = getSupabaseBrowserClient();
  const broadcastChannelRef = useRef<any>(null);

  // Language detection state
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [isLanguageDetectorSupported, setIsLanguageDetectorSupported] =
    useState(false);
  const languageDetectorRef = useRef<LanguageDetector | null>(null);

  const scribe = useScribe({
    modelId: "scribe_realtime_v2",
    onPartialTranscript: async (data) => {
      console.log("Partial:", { data });
      setPartialText(data.text);

      // Detect language from partial transcript
      const detectedLang = await detectLanguage(data.text);
      if (detectedLang) {
        setDetectedLanguage(detectedLang);
      }

      // Use detected language or fallback to Scribe's language_code
      const languageCode = detectedLang || (data as any).language_code;

      // Broadcast partial transcript to viewers via Realtime Broadcast
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.send({
          type: "broadcast",
          event: "partial_transcript",
          payload: {
            text: data.text,
            language_code: languageCode,
          },
        });
      }
    },
    onFinalTranscript: async (data) => {
      console.log("Final:", data.text);
      setPartialText("");

      // Detect language from final transcript
      const detectedLang = await detectLanguage(data.text);
      if (detectedLang) {
        setDetectedLanguage(detectedLang);
      }

      // Use detected language or fallback to Scribe's language_code
      const languageCode = detectedLang || (data as any).language_code;

      // Save to Supabase
      try {
        const { data: insertedCaption, error: insertError } = await supabase
          .from("captions")
          .insert({
            event_id: event.id,
            text: data.text,
            sequence_number: sequenceNumberRef.current++,
            is_final: true,
            language_code: languageCode,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error saving caption:", insertError);
        } else if (insertedCaption) {
          setCaptions((prev) => [...prev, insertedCaption]);
        }
      } catch (err) {
        console.error("Error saving caption:", err);
      }
    },
    onError: (error) => {
      console.error("Scribe error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setError(`Transcription error: ${errorMessage}`);
    },
  });

  // Detect language from text
  const detectLanguage = useCallback(
    async (text: string): Promise<string | null> => {
      if (!languageDetectorRef.current || text.length < 10) {
        return null; // Skip very short text for better accuracy
      }

      try {
        const results = await languageDetectorRef.current.detect(text);
        if (results.length > 0) {
          const topResult = results[0];
          // Only accept results with confidence > 0.5
          if (topResult.confidence > 0.5) {
            console.log(
              `Detected language: ${topResult.detectedLanguage} (confidence: ${topResult.confidence})`
            );
            return topResult.detectedLanguage;
          }
        }
      } catch (error) {
        console.error("Error detecting language:", error);
      }
      return null;
    },
    []
  );

  const copyViewerLink = () => {
    navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Enumerate audio devices
  useEffect(() => {
    const getAudioDevices = async () => {
      try {
        // Request permission first to get device labels
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        // Stop the stream immediately as we just needed permission
        stream.getTracks().forEach((track) => track.stop());

        // Now enumerate devices with labels
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(
          (device) => device.kind === "audioinput"
        );
        setAudioDevices(audioInputs);

        // Set default device if none selected
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error("Error enumerating devices:", err);
        setError("Failed to access microphone. Please grant permission.");
      }
    };

    getAudioDevices();
  }, [selectedDeviceId]);

  // Initialize Language Detector API
  useEffect(() => {
    const initLanguageDetector = async () => {
      if (typeof window !== "undefined" && "LanguageDetector" in window) {
        setIsLanguageDetectorSupported(true);
        try {
          const availability = await window.LanguageDetector!.availability();
          console.log("Language Detector availability:", availability);

          const detector = await window.LanguageDetector!.create({
            monitor(m) {
              m.addEventListener("downloadprogress", (e) => {
                console.log(
                  `Language Detector model download: ${Math.round(
                    e.loaded * 100
                  )}%`
                );
              });
            },
          });

          languageDetectorRef.current = detector;
          console.log("Language Detector initialized successfully");
        } catch (error) {
          console.error("Error initializing Language Detector:", error);
        }
      } else {
        console.log("Language Detector API not supported in this browser");
      }
    };

    initLanguageDetector();
  }, []);

  const fetchToken = async () => {
    try {
      const response = await fetch(`/api/scribe-token?eventUid=${event.uid}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch token");
      }

      const data = await response.json();
      return data.token;
    } catch (err) {
      console.error("Error fetching token:", err);
      throw err;
    }
  };

  const handleStartRecording = async () => {
    try {
      setError(null);

      // Fetch a single use token from the server
      const token = await fetchToken();

      const microphoneOptions: any = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      // Only add deviceId if one is selected
      if (selectedDeviceId) {
        microphoneOptions.deviceId = selectedDeviceId;
      }

      console.log(
        "Starting recording with microphone options:",
        microphoneOptions
      );

      const connectOptions: any = {
        token,
        microphone: microphoneOptions,
      };

      // Add language if specified (otherwise auto-detect)
      if (selectedLanguage) {
        connectOptions.language = selectedLanguage;
      }

      await scribe.connect(connectOptions);

      setIsRecording(true);
    } catch (err) {
      console.error("Error starting recording:", err);
      setError(
        err instanceof Error ? err.message : "Failed to start recording"
      );
    }
  };

  const handleStopRecording = async () => {
    try {
      await scribe.disconnect();
      setIsRecording(false);
      setPartialText("");
    } catch (err) {
      console.error("Error stopping recording:", err);
      setError(err instanceof Error ? err.message : "Failed to stop recording");
    }
  };

  // Load existing captions on mount
  useEffect(() => {
    const loadCaptions = async () => {
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
        sequenceNumberRef.current = data.length;
      }
    };

    loadCaptions();
  }, [event.id, supabase]);

  // Subscribe to realtime updates and set up broadcast channel
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
          console.log("New caption:", payload);
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

  // Set up broadcast channel for partial transcripts
  useEffect(() => {
    const broadcastChannel = supabase
      .channel(`broadcast:${event.uid}`)
      .subscribe((status: string) => {
        console.log("Broadcast channel status:", status);
      });

    broadcastChannelRef.current = broadcastChannel;

    return () => {
      supabase.removeChannel(broadcastChannel);
      broadcastChannelRef.current = null;
    };
  }, [event.uid, supabase]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Event Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-2xl">{event.title}</CardTitle>
                <Badge variant="secondary" className="gap-1">
                  <Radio className="h-3 w-3" />
                  Broadcaster
                </Badge>
              </div>
              {event.description && (
                <CardDescription className="text-base">
                  {event.description}
                </CardDescription>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium mb-2">Viewer Link</p>
              <div className="flex gap-2">
                <div className="flex-1 bg-muted px-3 py-2 rounded-md text-sm font-mono truncate">
                  {viewerUrl}
                </div>
                <Button variant="outline" size="sm" onClick={copyViewerLink}>
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/view/${event.uid}`} target="_blank">
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Share this link with your audience to let them view live
                captions
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Broadcasting Interface */}
      <Card>
        <CardHeader>
          <CardTitle>Broadcasting Controls</CardTitle>
          <CardDescription>
            {isRecording
              ? "Recording audio and transcribing in real-time"
              : "Start recording to begin live transcription"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Language Selector */}
            {!isRecording && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Language</label>
                <LanguageSelector
                  value={selectedLanguage}
                  onValueChange={setSelectedLanguage}
                />
                <p className="text-xs text-muted-foreground">
                  Select a specific language or use auto-detect
                </p>
              </div>
            )}

            {/* Microphone Selector */}
            {!isRecording && audioDevices.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Microphone</label>
                <Select
                  value={selectedDeviceId}
                  onValueChange={setSelectedDeviceId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    {audioDevices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label ||
                          `Microphone ${device.deviceId.slice(0, 8)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-center gap-4 p-8 bg-muted/50 border-2 border-dashed rounded-lg">
              {!isRecording ? (
                <Button
                  size="lg"
                  onClick={handleStartRecording}
                  disabled={scribe.isConnected || !selectedDeviceId}
                  className="gap-2"
                >
                  <Mic className="h-5 w-5" />
                  Start Recording
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={handleStopRecording}
                  disabled={!scribe.isConnected}
                  className="gap-2"
                >
                  <MicOff className="h-5 w-5" />
                  Stop Recording
                </Button>
              )}
            </div>

            {isRecording && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse delay-75"></span>
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse delay-150"></span>
                  </div>
                  <span className="font-medium">Recording in progress</span>
                </div>

                {/* Language Detection Indicator */}
                {isLanguageDetectorSupported && detectedLanguage && (
                  <div className="flex items-center gap-2 justify-center">
                    <Badge variant="secondary" className="gap-1.5">
                      <Languages className="h-3 w-3" />
                      Detected: {detectedLanguage.toUpperCase()}
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Caption Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Caption Preview</CardTitle>
          <CardDescription>
            See what your audience sees in real-time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/30 rounded-lg p-6 min-h-[300px] max-h-[500px] overflow-y-auto space-y-3">
            {captions.length === 0 && !partialText && (
              <p className="text-muted-foreground text-center py-12">
                Captions will appear here as you broadcast
              </p>
            )}

            {captions.map((caption) => {
              const timestamp = new Date(caption.timestamp).toLocaleTimeString(
                undefined,
                {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }
              );
              return (
                <div
                  key={caption.id}
                  className="bg-background/50 p-3 rounded border"
                >
                  <div className="text-xs text-muted-foreground mb-1">
                    {timestamp}
                  </div>
                  <div className="text-lg leading-relaxed">{caption.text}</div>
                </div>
              );
            })}

            {partialText && (
              <div className="bg-primary/5 p-3 rounded border border-primary/20">
                <div className="text-xs text-primary/50 mb-1">Live</div>
                <div className="text-lg leading-relaxed italic">
                  {partialText}
                </div>
              </div>
            )}
          </div>
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
