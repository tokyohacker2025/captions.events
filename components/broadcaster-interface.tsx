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
} from "lucide-react";
import Link from "next/link";
import { useScribe } from "@elevenlabs/react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
  const sequenceNumberRef = useRef(0);
  const supabase = getSupabaseBrowserClient();
  const broadcastChannelRef = useRef<any>(null);

  const scribe = useScribe({
    modelId: "scribe_realtime_v2",
    onPartialTranscript: (data) => {
      console.log("Partial:", data.text);
      setPartialText(data.text);

      // Broadcast partial transcript to viewers via Realtime Broadcast
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.send({
          type: "broadcast",
          event: "partial_transcript",
          payload: { text: data.text },
        });
      }
    },
    onFinalTranscript: async (data) => {
      console.log("Final:", data.text);
      setPartialText("");

      // Save to Supabase
      try {
        const { data: insertedCaption, error: insertError } = await supabase
          .from("captions")
          .insert({
            event_id: event.id,
            text: data.text,
            sequence_number: sequenceNumberRef.current++,
            is_final: true,
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

  const copyViewerLink = () => {
    navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

      await scribe.connect({
        token,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

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
            <div className="flex items-center justify-center gap-4 p-8 bg-muted/50 border-2 border-dashed rounded-lg">
              {!isRecording ? (
                <Button
                  size="lg"
                  onClick={handleStartRecording}
                  disabled={scribe.isConnected}
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
              <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse delay-75"></span>
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse delay-150"></span>
                </div>
                <span className="font-medium">Recording in progress</span>
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

            {captions.map((caption) => (
              <div
                key={caption.id}
                className="text-lg leading-relaxed bg-background/50 p-3 rounded border"
              >
                {caption.text}
              </div>
            ))}

            {partialText && (
              <div className="text-lg leading-relaxed bg-primary/5 p-3 rounded border border-primary/20 italic">
                {partialText}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
