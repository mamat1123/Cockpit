import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findPaneBySession, type Action, type AgentProvider, type Layout } from "../layout/paneLayout";
import { flattenPanes } from "./paneFlatten";
import { TerminalPane } from "./TerminalPane";
import { setPaneHeadroom, setPanePonytail, setPaneProvider } from "../lib/terminalRegistry";
import type { PonytailLevel } from "../lib/ponytailClient";
import { createCodexHandoff, createClaudeHandoff } from "../lib/handoffClient";

/** Mounts every pane's TerminalPane ONCE and portals it into the DOM slot for its
 *  current position. Moving a pane between tabs only retargets the portal, so the
 *  xterm + PTY + scrollback survive (no remount). While a slot is momentarily absent
 *  (mid-move), the pane parks in a hidden node so it stays mounted.
 *
 *  Drag-to-reposition feedback: the header is the drag handle; the whole pane is a drop
 *  zone. `dragId`/`overId` drive the dimmed-source + highlighted-target visuals so you
 *  can see where a pane will land (it's inserted AFTER the highlighted target). */
export function PaneHost({ layout, slots, dispatch, onRequestClose }: {
  layout: Layout;
  slots: Record<string, HTMLElement>;
  dispatch: (a: Action) => void;
  onRequestClose: (paneId: string) => void;
}) {
  const parkRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  useEffect(() => { force((n) => n + 1); }, []); // re-render once parkRef is mounted

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [handoffBusy, setHandoffBusy] = useState<string | null>(null);
  const endDrag = () => { setDragId(null); setOverId(null); };

  const park = parkRef.current;
  return (
    <>
      <div ref={parkRef} style={{ display: "none" }} />
      {park &&
        flattenPanes(layout).map(({ pane }) =>
          createPortal(
            <TerminalPane
              paneId={pane.id}
              cwd={pane.cwd}
              sessionId={pane.sessionId}
              resume={pane.resume}
              headroom={pane.headroom}
              ponytail={pane.ponytail ?? "off"}
              provider={pane.provider ?? "claude"}
              codexPromptPath={pane.codexPromptPath}
              claudePromptPath={pane.claudePromptPath}
              title={pane.title}
              focused={pane.id === layout.focusedPaneId}
              isDragging={dragId === pane.id}
              isDropTarget={overId === pane.id && dragId !== null && dragId !== pane.id}
              onFocus={() => dispatch({ type: "focusPane", paneId: pane.id })}
              onRename={(t) => dispatch({ type: "renamePane", paneId: pane.id, title: t })}
              onAutoTitle={(t) => dispatch({ type: "autoTitlePane", paneId: pane.id, title: t })}
              onSessionIdChange={(sessionId) => dispatch({ type: "setSessionId", paneId: pane.id, sessionId })}
              onPopOut={() => dispatch({ type: "popOut", paneId: pane.id })}
              onClose={() => onRequestClose(pane.id)}
              onToggleHeadroom={() => {
                // Optimistic flip for instant feedback, then bounce back to off if turning
                // ON couldn't actually engage the proxy (it fell back to direct) — so the
                // toggle never shows ON while silently going direct.
                const next = !pane.headroom;
                dispatch({ type: "setHeadroom", paneId: pane.id, on: next });
                void setPaneHeadroom(pane.id, pane.cwd, pane.sessionId, next, pane.ponytail ?? "off").then((engaged) => {
                  if (next && !engaged) dispatch({ type: "setHeadroom", paneId: pane.id, on: false });
                });
              }}
              onSetPonytail={(level: PonytailLevel) => {
                dispatch({ type: "setPonytail", paneId: pane.id, level });
                void setPanePonytail(pane.id, pane.cwd, pane.sessionId, level, !!pane.headroom, pane.provider ?? "claude");
              }}
              onSelectProvider={(target: AgentProvider) => {
                const current = pane.provider ?? "claude";
                if (current === target || handoffBusy === pane.id) return;
                const isClaudeFamily = (p: AgentProvider) => p === "claude" || p === "zai";

                // Read a Codex rollout into a fresh Claude-family pane (target = claude or zai).
                const handoffFromCodexInto = (into: AgentProvider) => {
                  setHandoffBusy(pane.id);
                  void createClaudeHandoff(pane.cwd)
                    .then((handoff) => {
                      dispatch({
                        type: "openClaudeHandoff",
                        sourcePaneId: pane.id,
                        cwd: pane.cwd,
                        promptPath: handoff.promptPath,
                        title: handoff.title ?? undefined,
                        provider: into,
                      });
                    })
                    .catch((err) => {
                      console.error("[cockpit] claude/zai handoff failed", err);
                      dispatch({ type: "openClaudeHandoff", sourcePaneId: pane.id, cwd: pane.cwd, provider: into });
                    })
                    .finally(() => setHandoffBusy((id) => (id === pane.id ? null : id)));
                };

                // Claude ↔ z.ai: same claude binary on another backend (same session jsonl),
                // so swap the endpoint in place (--resume) and keep the FULL conversation.
                // z.ai launches via `claude --glm`, which sources its creds from
                // ~/.claude/glm.env — no Cockpit-side token gate needed.
                if (isClaudeFamily(current) && isClaudeFamily(target)) {
                  dispatch({ type: "setProvider", paneId: pane.id, provider: target });
                  void setPaneProvider(pane.id, pane.cwd, pane.sessionId, target, pane.ponytail ?? "off", !!pane.headroom);
                  return;
                }

                // Claude/z.ai → Codex: summary handoff (this session logs in claude format).
                if (isClaudeFamily(current) && target === "codex") {
                  setHandoffBusy(pane.id);
                  void createCodexHandoff(pane.cwd, pane.sessionId)
                    .then((handoff) => {
                      if (handoff.sourceSessionId !== pane.sessionId) {
                        dispatch({ type: "setSessionId", paneId: pane.id, sessionId: handoff.sourceSessionId });
                      }
                      dispatch({
                        type: "openCodexHandoff",
                        sourcePaneId: pane.id,
                        cwd: pane.cwd,
                        promptPath: handoff.promptPath,
                        fromSessionId: handoff.sourceSessionId,
                        title: handoff.title ?? pane.title,
                      });
                    })
                    .catch((err) => {
                      console.error("[cockpit] codex handoff failed", err);
                      window.alert(`Codex handoff failed: ${String(err)}`);
                    })
                    .finally(() => setHandoffBusy((id) => (id === pane.id ? null : id)));
                  return;
                }

                // Codex → Claude: jump back to the origin session if this was a
                // Claude→Codex handoff, else summary-handoff into a fresh Claude pane.
                if (current === "codex" && target === "claude") {
                  if (pane.handoffFromSessionId) {
                    const hit = findPaneBySession(layout, pane.handoffFromSessionId);
                    if (hit) {
                      dispatch({ type: "focusTab", tabId: hit.tabId });
                      dispatch({ type: "focusPane", paneId: hit.paneId });
                    } else {
                      dispatch({ type: "openSession", cwd: pane.cwd, sessionId: pane.handoffFromSessionId });
                    }
                    return;
                  }
                  handoffFromCodexInto("claude");
                  return;
                }

                // Codex → z.ai: summary handoff into a fresh z.ai pane (creds via glm.env).
                if (current === "codex" && target === "zai") {
                  handoffFromCodexInto("zai");
                  return;
                }
              }}
              dragHandleProps={{
                draggable: true,
                onDragStart: (e) => {
                  e.dataTransfer.setData("text/plain", pane.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(pane.id);
                },
                onDragEnd: endDrag,
              }}
              dropZoneProps={{
                onDragEnter: (e) => {
                  e.preventDefault();
                  if (dragId && dragId !== pane.id) setOverId(pane.id);
                },
                onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; },
                onDrop: (e) => {
                  e.preventDefault();
                  const fromId = e.dataTransfer.getData("text/plain");
                  endDrag();
                  if (fromId && fromId !== pane.id) dispatch({ type: "movePaneAfter", paneId: fromId, targetPaneId: pane.id });
                },
              }}
            />,
            slots[pane.id] ?? park,
            pane.id,
          ),
        )}
    </>
  );
}
