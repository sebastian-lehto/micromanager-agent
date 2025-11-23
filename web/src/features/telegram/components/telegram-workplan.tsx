"use client";

import { Dispatch, SetStateAction, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  Loader2,
  RefreshCw,
  AlertCircle
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { WORKPLAN_DEFAULT_EVENT_LIMIT } from "@/lib/constants";
import { Input } from "@/components/ui/input";

import {
    WorkplanStatus,
    WorkplanEntry,
    StatusBadge,
    formatEventDateRange,
    timeAgo,
    getMockWorkplans,
    normaliseRole,
    inferRoleFromEvent
} from "@/features/workplan/components/workplan-panel"

const UPCOMING_DAYS = 7;

function WorkPlanTab({
  item,
  isActive,
  onClick,
}: {
  item: WorkplanEntry,
  isActive: boolean,
  onClick: () => void
}) {
  const startDate = item.event.start
    ? new Date(item.event.start)
    : null;
  const endDate = item.event.end
    ? new Date(item.event.end)
    : null;
  return (
    <button
      key={item.event.id}
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1 px-4 py-3 text-left transition ",
        isActive
            ? "bg-primary/10 text-primary"
            : "hover:bg-muted/60"
      )}
    >
      <span className="text-sm font-medium">
        {item.event.title}
      </span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {formatEventDateRange(startDate, endDate)}
      </span>
      {item.event.location && (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {item.event.location}
      </span>
      )}
      <div className="flex items-center gap-2 pt-1">
      <StatusBadge status={item.status} />
      {item.lastGeneratedAt && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
            Updated {timeAgo(item.lastGeneratedAt)}
          </span>
      )}
      </div>
    </button>
  );
};

function WorkPlanTabs({
  workplans,
  loadingList,
  selectedId,
  setSelectedId
} : {
  workplans: WorkplanEntry[],
  loadingList: boolean,
  selectedId: string | null,
  setSelectedId: Dispatch<SetStateAction<string | null>>
}) {
  if (loadingList) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading events...
      </div>
    ) 
  }
  if (workplans.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">
      No upcoming events found.
    </div>
  }
  return(
    <ScrollArea>
      <div className="border rounded-2xl border-border/60 bg-background/60 whitespace-nowrap overflow-hidden">
        <div className="flex flex-nowrap w-fit">
          {workplans.map(item => 
            <WorkPlanTab
              key={item.event.id}
              item={item}
              isActive={item.event.id === selectedId}
              onClick={() => setSelectedId(item.event.id)}
            />
          )}
        </div>
      </div>
    </ScrollArea>
  )
};

function WorkPlanRoleSelector({
  selectedRoleDraft,
  handleRoleChange,
  selected,
  handleRegenerate,
  regenerating,
  loadingList
} : {
  selectedRoleDraft: string,
  handleRoleChange: (eventId: string, value: string) => void,
  selected: WorkplanEntry | null,
  handleRegenerate: () => Promise<void>,
  regenerating: boolean,
  loadingList: boolean
}) {
  return (
    <div className="flex flex-row gap-2 max-[420px]:flex-col max-[420px]:items-start">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
          Role
        </span>
        <Input
          value={selectedRoleDraft}
          onChange={(event) => selected 
            ? handleRoleChange(selected.event.id, event.target.value)
            : null
          }
          placeholder={selected ? inferRoleFromEvent(selected.event) : '...'}
          className="h-9 w-full min-w-[180px]"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleRegenerate}
        disabled={regenerating || loadingList}
        className="gap-2"
      >
        {regenerating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Regenerate plan
      </Button>
    </div>
  )
};

export function TelegramWorkPlanPanel() {
  const [workplans, setWorkplans] = useState<WorkplanEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingList(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/workplan?days=${UPCOMING_DAYS}&limit=${WORKPLAN_DEFAULT_EVENT_LIMIT}`,
          {
            cache: "no-store",
          }
        );
        if (!res.ok) {
          throw new Error(`Failed to load workplans (status ${res.status})`);
        }
        const data = (await res.json()) as { workplans?: WorkplanEntry[] };
        const items = (data.workplans ?? []).filter(Boolean);
        if (!cancelled) {
          if (items.length === 0) {
            const mocks = getMockWorkplans();
            setWorkplans(mocks);
            setRoleDrafts(
              mocks.reduce<Record<string, string>>((acc, item) => {
                acc[item.event.id] = item.role?.trim() ?? "";
                return acc;
              }, {})
            );
            setSelectedId(mocks[0]?.event.id ?? null);
          } else {
            setWorkplans(items);
            setRoleDrafts((prev) => {
              const next = { ...prev };
              for (const item of items) {
                if (typeof next[item.event.id] === "undefined") {
                  next[item.event.id] = item.role?.trim() ?? "";
                }
              }
              return next;
            });
            setSelectedId(items[0]?.event.id ?? null);
          }
        }
      } catch (err) {
        console.error("[WorkplanPanel] Load error:", err);
        if (!cancelled) {
          const mocks = getMockWorkplans();
          setWorkplans(mocks);
          setRoleDrafts(
            mocks.reduce<Record<string, string>>((acc, item) => {
              acc[item.event.id] = item.role?.trim() ?? "";
              return acc;
            }, {})
          );
          setSelectedId(mocks[0]?.event.id ?? null);
          setError("Failed to load upcoming workplans. Showing examples.");
        }
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => workplans.find((item) => item.event.id === selectedId) ?? null,
    [workplans, selectedId]
  );
  const selectedRoleDraft = selected
    ? roleDrafts[selected.event.id] ?? ""
    : "";
  const selectedRoleFallback =
    selected && selected.role
      ? selected.role.trim()
      : selected
      ? inferRoleFromEvent(selected.event)
      : "";
  const selectedRoleDisplay =
    selected && selectedRoleDraft.trim().length === 0
      ? selectedRoleFallback
      : selectedRoleDraft.trim();

  function handleRoleChange(eventId: string, value: string) {
    setRoleDrafts((prev) => ({
      ...prev,
      [eventId]: value,
    }));
    setWorkplans((prev) =>
      prev.map((item) =>
        item.event.id === eventId
          ? {
              ...item,
              role: normaliseRole(value),
            }
          : item
      )
    );
  }

  async function handleRegenerate() {
    if (!selected) return;
    setRegenerating(true);
    setError(null);
    try {
      const draftRole = roleDrafts[selected.event.id] ?? "";
      const payloadRole = normaliseRole(draftRole);
      const res = await fetch("/api/workplan/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: selected.event,
          userRole: payloadRole ?? undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(`Regeneration failed with status ${res.status}`);
      }
      const data = (await res.json()) as {
        event: WorkplanEntry["event"];
        steps: string[];
        status: WorkplanStatus;
        lastGeneratedAt?: string;
        role?: string | null;
      };
      setWorkplans((prev) =>
        prev.map((item) =>
          item.event.id === selected.event.id
            ? {
                ...item,
                steps: data.steps ?? [],
                status: data.status ?? "ready",
                lastGeneratedAt: data.lastGeneratedAt,
                error: undefined,
                role:
                  normaliseRole(data.role ?? undefined) ??
                  payloadRole ??
                  null,
              }
            : item
        )
      );
      setRoleDrafts((prev) => ({
        ...prev,
        [selected.event.id]:
          selectedRoleDraft.trim().length > 0
            ? selectedRoleDraft.trim()
            : data.role ?? "",
      }));
    } catch (err) {
      console.error("[WorkplanPanel] Regenerate error:", err);
      setError("Unable to regenerate workplan right now. Try again later.");
    } finally {
      setRegenerating(false);
    }
  }

  const selectedContent = selected ? (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            {selected.event.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {formatEventDateRange(
                selected.event.start ? new Date(selected.event.start) : null,
                selected.event.end ? new Date(selected.event.end) : null
              )}
            </span>
            {selected.event.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {selected.event.location}
              </span>
            )}
          </div>
        </div>
       
      </div>

      {selected.error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {selected.error}
        </div>
      )}

      <div className="space-y-1 text-sm text-muted-foreground">
        {selectedRoleDisplay && (
          <p className="text-xs uppercase tracking-wide text-muted-foreground/70">
            {/* Assuming role:{" "}
            <span className="font-semibold text-foreground">
              {selectedRoleDisplay}
            </span> */}
          </p>
        )}
        {selected.event.description && (
          <p className="leading-relaxed">{selected.event.description}</p>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground/80">
          Planned Steps
        </h4>
        {selected.steps.length === 0 ? (
          <div className="rounded-md border border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
            No plan available yet. Try regenerating once the agent can reach your
            calendar.
          </div>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
            {selected.steps.map((step, index) => (
              <li key={index} className="leading-relaxed">
                {step}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Calendar className="h-8 w-8" />
      Select an upcoming event to see its workplan.
    </div>
  );

  return (
    <Card className="border border-border/70 bg-card/80 shadow-lg">
      <CardHeader className="flex flex-col gap-2">
        <CardTitle className="flex items-center gap-2 text-xl font-semibold">
          <Calendar className="h-5 w-5" />
          Upcoming Workplans
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Micromanager auto-prepares step-by-step plans for your next{" "}
          {WORKPLAN_DEFAULT_EVENT_LIMIT} calendar events. Select an event to see
          the cached plan or regenerate it for fresh guidance.
        </p>
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
      </CardHeader>
      
      <CardContent className="grid gap-6">
        <WorkPlanTabs
          workplans={workplans}
          loadingList={loadingList}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
        />
        <WorkPlanRoleSelector 
          selectedRoleDraft={selectedRoleDraft}
          handleRoleChange={handleRoleChange}
          selected={selected}
          handleRegenerate={handleRegenerate}
          regenerating={regenerating}
          loadingList={loadingList}
        />
        {selectedContent}
      </CardContent>
    </Card>
  );
}

