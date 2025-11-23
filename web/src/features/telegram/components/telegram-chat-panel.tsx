"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Send, Loader2, Phone, PhoneOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { StoredMessage } from "@/lib/conversations";
import { TIER_PERMISSIONS, type UserProfile } from "@/types/user";
import { useRealtimeAgent } from "@/features/chat/hooks/use-realtime-agent";
import type { ChatMessage } from "@/features/chat/types";
import { TelegramWorkPlanPanel } from "./telegram-workplan";

const DEFAULT_TICKER_CONTENT = {
  user: "",
  assistant: "",
  tools: "",
} as const;

// Helper function to get tool short name with emoji
const getToolShortName = (toolName: string): string => {
  const toolNameMap: Record<string, string> = {
    get_user_context: "📖 Read Context",
    update_user_context: "✏️ Update Context",
    get_conversation_messages: "💬 Messages",
    "list-calendars": "📅 List Calendars",
    "list-events": "📅 List Events",
    "search-events": "🔍 Search Events",
    "get-event": "📝 Get Event",
    "create-event": "✨ Create Event",
    "update-event": "🔄 Update Event",
    "delete-event": "🗑️ Delete Event",
    "get-freebusy": "⏰ Free/Busy",
    "get-current-time": "🕐 Current Time",
    "get_google_task_lists": "📊 Get Task lists",
    "get_google_tasks": "🗓 Get Tasks",
    "create_google_task_list": "⚒️ Create Task list",
    "insert_google_task": "✅ Insert Task",
    "update_google_task": "💾 Update a Task",
  };
  return toolNameMap[toolName] || `🔧 ${toolName}`;
};

interface TelegramChatPanelProps {
  userId: string;
  userName: string;
}

export function TelegramChatPanel({
  userId,
  userName,
}: TelegramChatPanelProps) {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [toolCallHistory, setToolCallHistory] = useState<
    Array<{
      toolName: string;
      displayTitle: string;
      displayDescription?: string;
      arguments: Record<string, unknown>;
      result?: unknown;
      status: "pending" | "success" | "error";
      error?: string;
      duration?: number;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);
  const [selectedTool, setSelectedTool] = useState<
    (typeof toolCallHistory)[0] | null
  >(null);
  const [isToolModalOpen, setIsToolModalOpen] = useState(false);
  const [showWorkPlan, setShowWorkPlan] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleRealtimeMessages = useCallback(
    (incoming: ChatMessage[]) => {
      if (incoming.length === 0) return;

      setMessages((prev) => {
        const existingIds = new Set(prev.map((msg) => msg.id).filter(Boolean));
        const mapped = incoming.map<StoredMessage>((message) => {
          const createdAtIso = message.createdAt ?? new Date().toISOString();
          const createdDate = new Date(createdAtIso);
          const type: StoredMessage["type"] = "text";

          return {
            id: message.id,
            userId,
            role: message.role,
            content: message.content,
            type,
            createdAt: createdDate,
            updatedAt: createdDate,
            source:
              message.role === "assistant" || message.role === "tool"
                ? "realtime-agent"
                : "telegram-user",
          } satisfies StoredMessage;
        });

        const deduped = mapped.filter(
          (msg) => !msg.id || !existingIds.has(msg.id)
        );
        if (deduped.length === 0) {
          return prev;
        }

        const next = [...prev, ...deduped];
        next.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        return next;
      });
    },
    [userId]
  );

  const realtime = useRealtimeAgent({
    onMessages: handleRealtimeMessages,
    onError: (voiceError) => {
      console.error("Realtime agent error:", voiceError);
      setError(voiceError.message);
    },
    getAuthToken: () => localStorage.getItem("telegram-token"),
  });

  const voiceStateLabel = useMemo(() => {
    const state = realtime.voiceSignals.state;
    if (state === "idle") return "Idle";
    if (state === "listening") return "Listening";
    if (state === "processing") return "Processing";
    if (state === "speaking") return "Speaking";
    if (state === "connecting") return "Connecting";
    if (state === "executing") return "Executing";
    if (state === "ended") return "Ended";
    if (state === "error") return "Error";
    return state;
  }, [realtime.voiceSignals.state]);

  const isVoiceActive = realtime.isVoiceActive;
  const displayIdentity = profile?.email ?? userName;

  const lastUserMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "user") {
        return message.content;
      }
    }
    return null;
  }, [messages]);

  const lastAssistantMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant") {
        return message.content;
      }
    }
    return null;
  }, [messages]);

  const hasLastMessageError = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant") {
        return message.metadata?.error === true;
      }
    }
    return false;
  }, [messages]);

  // Load user profile and usage
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const token = localStorage.getItem("telegram-token");
        const response = await fetch("/api/user/profile", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setProfile(data);
        }
      } catch (err) {
        console.error("Failed to load user profile:", err);
      }
    };

    loadProfile();
    // Refresh profile every minute
    const interval = setInterval(loadProfile, 60000);
    return () => clearInterval(interval);
  }, []);

  // Load message history
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const token = localStorage.getItem("telegram-token");
        const response = await fetch("/api/telegram/chat/history", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setMessages(data.messages || []);
        }
      } catch (err) {
        console.error("Failed to load message history:", err);
      }
    };

    loadMessages();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Poll for workflow runs - show current run when active, previous run when idle
  useEffect(() => {
    const pollWorkflowRuns = async () => {
      try {
        const token = localStorage.getItem("telegram-token");
        const response = await fetch("/api/user/workflow-runs", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();

          // Use current workflow if running, otherwise show previous workflow
          const workflowToDisplay = isLoading ? data.current : data.previous;

          if (workflowToDisplay?.toolCalls) {
            // Convert toolCalls object to array and sort by createdAt descending (newest first)
            type ToolCall = {
              toolName: string;
              displayTitle: string;
              displayDescription?: string;
              arguments: Record<string, unknown>;
              result?: unknown;
              status: "pending" | "success" | "error";
              error?: string;
              duration?: number;
              createdAt: string;
              updatedAt: string;
            };
            const toolCallsArray = (
              Object.values(workflowToDisplay.toolCalls) as ToolCall[]
            ).map((call) => ({
              toolName: call.toolName,
              displayTitle: call.displayTitle,
              displayDescription: call.displayDescription,
              arguments: call.arguments,
              result: call.result,
              status: call.status,
              error: call.error,
              duration: call.duration,
              createdAt: call.createdAt,
              updatedAt: call.updatedAt,
            }));

            toolCallsArray.sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime()
            );

            setToolCallHistory(toolCallsArray);
          }
        }
      } catch (err) {
        console.error("Failed to fetch workflow runs:", err);
      }
    };

    // Fetch immediately
    pollWorkflowRuns();

    // Only poll continuously while workflow is active
    if (isLoading) {
      const interval = setInterval(pollWorkflowRuns, 2000);
      return () => clearInterval(interval);
    }

    // When idle, we've already fetched once above, no need to poll
    return () => {};
  }, [isLoading]);

  const retryLastMessage = useCallback(() => {
    // Find last user message and resubmit it
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "user") {
        setInput(message.content);
        // Trigger form submission after a small delay
        setTimeout(() => {
          formRef.current?.requestSubmit();
        }, 100);
        return;
      }
    }
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: StoredMessage = {
      id: Date.now().toString(),
      content: input.trim(),
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      type: "text",
      userId: userId,
      source: "telegram-user",
    };
    setShowWorkPlan(false)
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);
    setToolCallHistory([]);

    try {
      const token = localStorage.getItem("telegram-token");
      const response = await fetch("/api/telegram/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: userMessage.content,
          userId,
        }),
      });

      if (!response.ok) {
        console.log(response)
        throw new Error("Failed to send message");
      }

      const data = await response.json();

      const metadata: StoredMessage["metadata"] = {};
      if (typeof data.tokensUsed === "number") {
        metadata.tokensUsed = data.tokensUsed;
      }
      if (
        typeof data.reasoning === "string" &&
        data.reasoning.trim().length > 0
      ) {
        metadata.reasoning = data.reasoning.trim();
      }

      // Check if workflow returned an error
      if (data.error === true) {
        metadata.error = true;
      }

      const assistantMessage: StoredMessage = {
        id: Date.now().toString() + "-assistant",
        content: data.response,
        role: "assistant",
        createdAt: new Date(),
        updatedAt: new Date(),
        type: "text",
        userId: userId,
        source: "micromanager",
        metadata: Object.keys(metadata).length ? metadata : undefined,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Update usage tracking
      if (data.tokensUsed) {
        await fetch("/api/user/usage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            tokens: data.tokensUsed,
            messages: 1,
          }),
        });

        // Refresh profile to show updated usage
        const profileResponse = await fetch("/api/user/profile", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (profileResponse.ok) {
          const updatedProfile = await profileResponse.json();
          setProfile(updatedProfile);
        }
      }
    } catch (err) {
      console.error("Error sending message:", err);
      setError("Failed to send message. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleVoice = async () => {
    if (!TIER_PERMISSIONS[profile?.tier ?? "free"].hasVoiceAccess) return;
    try {
      setError(null);
      if (isVoiceActive) {
        await realtime.stopSession();
      } else {
        await realtime.startSession();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to toggle voice session";
      setError(message);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="bg-card/60 px-3 py-3">
        <div className="space-y-3">
          {TIER_PERMISSIONS[profile?.tier ?? "free"].hasVoiceAccess && (
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant={profile?.tier === "paid" ? "secondary" : "outline"}
                >
                  {profile?.tier?.toUpperCase() ?? "FREE"}
                </Badge>
                <span className="text-sm font-medium text-foreground">
                  {displayIdentity}
                </span>
                {voiceStateLabel !== "Idle" && (
                  <span
                    className={cn(
                      "font-medium text-xs ",
                      isVoiceActive ? "text-foreground" : undefined
                    )}
                  >
                    Voice agent: {voiceStateLabel}
                  </span>
                )}
              </div>
              {TIER_PERMISSIONS[profile?.tier ?? "free"].hasVoiceAccess && (
                <Button
                  size="sm"
                  variant={isVoiceActive ? "destructive" : "default"}
                  onClick={toggleVoice}
                  className="gap-2"
                >
                  {realtime.voiceSignals.state === "connecting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Connecting
                    </>
                  ) : realtime.voiceSignals.state === "processing" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing
                    </>
                  ) : isVoiceActive ? (
                    <>
                      <PhoneOff className="h-4 w-4" />
                      End Call
                    </>
                  ) : (
                    <>
                      <Phone className="h-4 w-4" />
                      Voice Call
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
          {TIER_PERMISSIONS[profile?.tier ?? "free"].hasVoiceAccess && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                {realtime.voiceSignals.transcript ? (
                  <span className="truncate">
                    User: {realtime.voiceSignals.transcript}
                  </span>
                ) : null}
                {realtime.voiceSignals.agentSpeech ? (
                  <span className="truncate">
                    Assistant: {realtime.voiceSignals.agentSpeech}
                  </span>
                ) : null}
              </div>
            </div>
          )}
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="bg-background/80 p-3 pb-6 shadow-sm"
          >
            <div className="flex gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    formRef.current?.requestSubmit();
                  }
                }}
                placeholder="Type your message..."
                disabled={isLoading}
                className="min-h-[44px] max-h-[200px] flex-1 resize-none rounded-lg border bg-background px-6 pt-[10px] text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                rows={1}
              />
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !input.trim()}
                className="min-h-[44px] min-w-[44px] rounded-lg"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <div className="flex-1 pl-6 pr-6">
        <div className="pb-8">
          <div className='flex border rounded-lg overflow-hidden'>
            <Button
              onClick={(e) => setShowWorkPlan(false)}
              variant={!showWorkPlan ? "soft" : "ghost"}
              className="w-full rounded-none"
            >Chat log</Button>
            <Button
              onClick={(e) => setShowWorkPlan(true)}
              variant={showWorkPlan ? "soft" : "ghost"}
              className="w-full rounded-none"
            >Workplan</Button>
          </div>
        </div>
        {showWorkPlan 
          ? <TelegramWorkPlanPanel />
          : <StatusTickerSection
              userText={lastUserMessage ?? DEFAULT_TICKER_CONTENT.user}
              assistantText={
                isLoading
                  ? ""
                  : lastAssistantMessage ?? DEFAULT_TICKER_CONTENT.assistant
              }
              isWorkflowActive={isLoading}
              hasError={hasLastMessageError}
              onRetry={retryLastMessage}
              toolCallHistory={toolCallHistory}
              onToolClick={(tool) => {
                setSelectedTool(tool);
                setIsToolModalOpen(true);
              }}
            />
        }
      </div>
      

      {/* Tool Call Details Modal */}
      <Dialog open={isToolModalOpen} onOpenChange={setIsToolModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedTool && getToolShortName(selectedTool.toolName)}
              {selectedTool && (
                <Badge
                  variant={
                    selectedTool.status === "success"
                      ? "default"
                      : selectedTool.status === "error"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {selectedTool.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedTool && (
            <div className="space-y-4">
              {/* Description */}
              {selectedTool.displayTitle && (
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                    Log Message
                  </h4>
                  <p className="text-sm text-foreground/90 italic">
                    {selectedTool.displayTitle}
                  </p>
                </div>
              )}

              {/* Tool Name */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                  Tool Name
                </h4>
                <code className="text-sm bg-muted px-2 py-1 rounded">
                  {selectedTool.toolName}
                </code>
              </div>

              {/* Arguments */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                  Arguments
                </h4>
                <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap break-words">
                  {JSON.stringify(selectedTool.arguments, null, 2)}
                </pre>
              </div>

              {/* Response */}
              {selectedTool.result !== undefined && (
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                    Response
                  </h4>
                  <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap break-words">
                    {JSON.stringify(selectedTool.result, null, 2)}
                  </pre>
                </div>
              )}

              {/* Error */}
              {selectedTool.error && (
                <div>
                  <h4 className="text-sm font-semibold text-destructive mb-1">
                    Error
                  </h4>
                  <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded whitespace-pre-wrap break-words">
                    {selectedTool.error}
                  </pre>
                </div>
              )}

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-4">
                {selectedTool.duration !== undefined && (
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Duration
                    </h4>
                    <p className="text-sm">{selectedTool.duration}ms</p>
                  </div>
                )}
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                    Created At
                  </h4>
                  <p className="text-xs">
                    {new Date(selectedTool.createdAt).toLocaleString()}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                    Updated At
                  </h4>
                  <p className="text-xs">
                    {new Date(selectedTool.updatedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface StatusTickerSectionProps {
  userText: string;
  assistantText: string;
  isWorkflowActive: boolean;
  hasError: boolean;
  onRetry: () => void;
  toolCallHistory: Array<{
    toolName: string;
    displayTitle: string;
    displayDescription?: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "success" | "error";
    error?: string;
    duration?: number;
    createdAt: string;
    updatedAt: string;
  }>;
  onToolClick: (tool: {
    toolName: string;
    displayTitle: string;
    displayDescription?: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "success" | "error";
    error?: string;
    duration?: number;
    createdAt: string;
    updatedAt: string;
  }) => void;
}

function StatusTickerSection({
  userText,
  assistantText,
  isWorkflowActive,
  hasError,
  onRetry,
  toolCallHistory,
  onToolClick,
}: StatusTickerSectionProps) {
  return (
    <div className="relative overflow-hidden space-y-0">
      {/* CMD Section with unique background */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-cyan-500/10 to-blue-500/10" />
        <div className="relative z-10">
          <TickerRow label="USER" text={userText} />
        </div>
      </div>

      {/* MM Section with animated gradient */}
      <div
        className={cn(
          "relative overflow-hidden transition-[min-height] duration-500 ease-out",
          hasError
            ? "shadow-[inset_0_0_0_1px_rgba(248,113,113,0.2)]"
            : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
        )}
        style={{ minHeight: isWorkflowActive ? "112px" : "96px" }}
      >
        <div className="agent-wave-surface" aria-hidden="true" />
        <div className="relative z-10">
          <TickerRow
            label="AGENT"
            text={assistantText}
            isAnimating={isWorkflowActive}
            hasError={hasError}
            onRetry={onRetry}
            variant="agent"
          />
        </div>
      </div>

      {/* TOOLS Section with pulse animation */}
      <div className="relative overflow-hidden">
        <div className="tools-wave-surface" aria-hidden="true" />
        <div className="relative z-10">
          <TickerRow
            label="TOOLS"
            text=""
            isToolsRow
            isAnimating={isWorkflowActive}
            toolCallHistory={toolCallHistory}
            onToolClick={onToolClick}
            variant="tools"
          />
        </div>
      </div>
    </div>
  );
}

interface TickerRowProps {
  label: string;
  text: string;
  className?: string;
  isToolsRow?: boolean;
  isAnimating?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  toolCallHistory?: Array<{
    toolName: string;
    displayTitle: string;
    displayDescription?: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "success" | "error";
    error?: string;
    duration?: number;
    createdAt: string;
    updatedAt: string;
  }>;
  onToolClick?: (tool: {
    toolName: string;
    displayTitle: string;
    displayDescription?: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "success" | "error";
    error?: string;
    duration?: number;
    createdAt: string;
    updatedAt: string;
  }) => void;
  variant?: "default" | "agent" | "tools";
}

function TickerRow({
  label,
  text,
  className,
  isToolsRow = false,
  isAnimating = false,
  hasError = false,
  onRetry,
  toolCallHistory = [],
  onToolClick,
  variant = "default",
}: TickerRowProps) {
  const getStatusIcon = (status: "pending" | "success" | "error") => {
    if (status === "pending") return "⏳";
    if (status === "success") return "✓";
    if (status === "error") return "✗";
    return "";
  };

  const getStatusColor = (status: "pending" | "success" | "error") => {
    if (status === "pending") return "text-yellow-500";
    if (status === "success") return "text-green-500";
    if (status === "error") return "text-red-500";
    return "";
  };

  const animatedPadding =
    variant === "agent" ? (isAnimating ? "py-6" : "py-4") : "py-4";
  const showAgentSkeleton = variant === "agent" && isAnimating;

  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-4 transition-all duration-500 ease-out",
        animatedPadding
      )}
    >
      <div className="flex flex-row gap-4 items-start">
        <span className="pt-1 text-[10px] text-center font-semibold uppercase tracking-widest text-muted-foreground/80 shrink-0 min-w-10">
          {label}
        </span>
        {isToolsRow ? (
          <div className="flex flex-col gap-2 flex-1 w-full">
            {toolCallHistory.length > 0 ? (
              <div className="flex flex-col gap-2 w-full pt-1">
                {toolCallHistory.map((tool, index) => (
                  <div
                    key={`${tool.createdAt}-${index}`}
                    onClick={() => onToolClick?.(tool)}
                    className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-background/60 border border-border/40 cursor-pointer hover:bg-background/80 transition-colors w-full"
                  >
                    {/* Row 1: Short name with emoji + status emoji */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        {getToolShortName(tool.toolName)}
                      </span>
                      <span
                        className={cn("text-sm", getStatusColor(tool.status))}
                      >
                        {getStatusIcon(tool.status)}
                      </span>
                    </div>
                    {/* Row 2: Agent's custom description in italic */}
                    <div className="text-xs italic text-muted-foreground">
                      {tool.displayTitle}
                    </div>
                  </div>
                ))}
              </div>
            ) : isAnimating ? (
              <div className="flex flex-col gap-2 w-full pt-1">
                <div className="loader-line" />
              </div>
            ) : (
              <></>
            )}
            {isAnimating && <div className="loader-line is-secondary mt-2" />}
          </div>
        ) : (
          <div className="flex items-center gap-2 ml-1 flex-1">
            {showAgentSkeleton ? (
              <div className="flex w-full flex-col gap-2">
                <div className="loader-line" />
                <div className="loader-line is-secondary" />
              </div>
            ) : (
              <>
                <span
                  className={cn(
                    "text-sm leading-relaxed font-normal text-foreground/90 flex-1 max-w-[calc(100vw-123px)] text-wrap break-words",
                    isAnimating && "opacity-60 animate-pulse",
                    hasError && "text-red-500/90",
                    className
                  )}
                >
                  {text}
                </span>
                {hasError && onRetry && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onRetry}
                    className="gap-1.5 h-7 text-xs"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
