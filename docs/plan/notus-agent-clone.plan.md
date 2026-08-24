# notus-agent-clone -- Implementation Plan

> 创建日期: 2026-08-24
> 状态: 已完成

## 0. Architecture Overview

### 0.1 Current WeaveMD Architecture

```
User Message
  -> agentStore.sendAgentMessage() [render]
    -> IPC AGENT_RUN [preload bridge]
      -> agentHandlers.ts [main/ipc]
        -> runAgentFlow() [agentLoop.ts]
          -> sync 6-round for-loop
            -> streamChatCompletion() [llmClient.ts]
            -> executeTool() [toolRegistry.ts]
          -> IPC AI_STREAM_CHUNK / AI_STREAM_TOOL / AI_STREAM_DONE
```

Key characteristics:
- Synchronous 6-round loop, blocks until complete or max rounds
- 3-state processStatus: idle / thinking / tool_calling
- No persistence of task state; crash = lost progress
- No task queue; one request at a time
- No checkpoint/resume capability
- 7 tools: listFiles, readFile, searchKB, runSkill, editBlocks, createFile, createFolder
- SSE events are ephemeral (in-memory push only)

### 0.2 Target Notus Architecture

```
User Message
  -> enqueue task to agent_task_queue (SQLite FIFO) [main]
    -> agentTaskWorker polls (1s interval)
      -> agentSession state machine (10+ states)
        -> agentLoop (checkpoint-gated LLM calls)
          -> checkpoint saved before each LLM call / tool exec
          -> SSE events persisted to agent_run_events table
          -> tool results + final reply pushed via SSE
```

Key characteristics:
- Persistent task queue with SQLite FIFO, same-conversation serial
- Session state machine: created -> queued -> running -> waiting_interaction / waiting_operation_confirmation / completed / failed / cancelled
- Checkpoint/resume at every LLM call boundary and tool execution boundary
- SSE events persisted before push; incremental replay on reconnect
- Dead loop detection (3x same result / 2x consecutive failure)
- Task supersede (new message cancels old waiting tasks)
- File snapshot + rollback per session

### 0.3 Migration Strategy

The strategy is **full replacement with a compatibility shim**. The existing `runAgentFlow()` function signature and return type (`AgentRunResult`) will be preserved as the public API. Internally, the implementation will be completely replaced with the queue + session state machine + checkpoint architecture. The old 6-round loop code will be deleted. The IPC handler `AGENT_RUN` will enqueue a task instead of executing synchronously, and the response will come back via SSE events (same channels already in use: `AI_STREAM_CHUNK`, `AI_STREAM_TOOL`, `AI_STREAM_DONE`, `AI_STREAM_ERROR`). This means the render-side `agentStore.sendAgentMessage()` flow requires minimal changes -- it already listens for SSE events.

---

## 1. Database Schema Changes

### 1.1 New Tables

All new tables use the same migration pattern as the existing codebase: `CREATE TABLE IF NOT EXISTS` in `runMigrations()`, with `addColumnIfMissing()` for incremental column additions.

**Table: `agent_task_queue`**

```sql
CREATE TABLE IF NOT EXISTS agent_task_queue (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|running|completed|failed|cancelled|superseded
  priority        INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  started_at      TEXT,
  completed_at    TEXT,
  error_code      TEXT,
  error_message   TEXT,
  -- payload extras (JSON blob for useKnowledgeBase, kbSettings, currentDocument)
  payload_json    TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_agent_task_queue_status ON agent_task_queue(status);
CREATE INDEX IF NOT EXISTS idx_agent_task_queue_conv ON agent_task_queue(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_task_queue_user ON agent_task_queue(user_id);
```

**Table: `agent_sessions`**

```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  task_id         TEXT REFERENCES agent_task_queue(id) ON DELETE SET NULL,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'created',
  -- created|queued|running|waiting_interaction|waiting_operation_confirmation|
  -- waiting_limit|waiting_retry|waiting_model_recovery|completed|failed|cancelled
  rounds_used     INTEGER DEFAULT 0,
  max_rounds      INTEGER DEFAULT 20,
  intent_json     TEXT,
  checkpoint_json TEXT,           -- serialized checkpoint data
  snapshot_json   TEXT,           -- file snapshot at session creation
  lease_owner     TEXT,           -- process ID for lease mechanism
  lease_expires_at TEXT,          -- lease expiration timestamp
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_conv ON agent_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
```

**Table: `agent_run_events`**

```sql
CREATE TABLE IF NOT EXISTS agent_run_events (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  seq             INTEGER NOT NULL,  -- monotonic sequence per session
  event_type      TEXT NOT NULL,     -- chunk|tool|done|error|checkpoint|state_change
  payload_json    TEXT NOT NULL,     -- full event payload
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_session ON agent_run_events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_conv ON agent_run_events(conversation_id, seq);
```

**Table: `agent_file_snapshots`**

```sql
CREATE TABLE IF NOT EXISTS agent_file_snapshots (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  file_id         TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_file_snapshots_session ON agent_file_snapshots(session_id);
```

### 1.2 Migration Location

All new tables will be added to the `runMigrations()` function in `D:\software\WeaveMD\src\main\db\index.ts`, following the exact same pattern as existing tables (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).

---

## 2. P0 -- Core Experience (6 items)

### P0-1: Agent Session State Machine (A2)

**Goal**: Replace 3-state `processStatus` with 10+ session lifecycle states.

**State Diagram**:
```
created -> queued -> running -> completed
                            -> failed
                            -> cancelled
                            -> waiting_interaction (ask_question_card)
                            -> waiting_operation_confirmation (file writes)
                            -> waiting_limit (max rounds approaching)
                            -> waiting_retry (recoverable LLM error)
                            -> waiting_model_recovery (model unavailable)
```

**Files to create**:
- `src/main/ai/agentSession.ts` -- State machine implementation, transition validation, DB persistence
- `src/main/db/agentSessionDao.ts` -- CRUD for agent_sessions table

**Files to modify**:
- `src/shared/ai.ts` -- Add `AgentSessionStatus` type, `AgentSession` interface
- `src/render/stores/agentStore.ts` -- Replace `processStatus: AIProcessStatus` with `sessionStatus: AgentSessionStatus` derived from IPC
- `src/main/ai/ipc/agentHandlers.ts` -- New IPC handler for session status queries

**Implementation steps**:
1. Define `AgentSessionStatus` union type in `shared/ai.ts`
2. Create `agentSessionDao.ts` with `createSession()`, `getSession()`, `updateSessionStatus()`, `listSessionsByConversation()`
3. Create `agentSession.ts` with `AgentSessionStateMachine` class:
   - Constructor takes sessionId, validates initial state
   - `transition(to: AgentSessionStatus)` -- validates legal transitions, persists to DB, emits state change event
   - `getStatus()` -- returns current state
   - Illegal transitions throw with descriptive error
4. Add IPC channel `AGENT_SESSION_STATUS` for render-side polling
5. Update `agentStore.ts` to track session status from IPC responses

**Acceptance criteria**:
- All 10+ states are defined and reachable via legal transitions
- Illegal transitions are rejected with error messages
- State is persisted to SQLite on every transition
- UI displays current session status correctly

---

### P0-2: Checkpoint/Resume System (A4)

**Goal**: Save execution state at LLM call boundaries and tool execution boundaries; enable resume from any checkpoint.

**Files to create**:
- `src/main/ai/agentCheckpoint.ts` -- Checkpoint serialization/deserialization, save/load

**Files to modify**:
- `src/main/ai/agentLoop.ts` -- Replace the for-loop with checkpoint-gated execution
- `src/main/db/agentSessionDao.ts` -- Checkpoint persistence fields

**Implementation steps**:
1. Define `AgentCheckpoint` interface:
   ```typescript
   interface AgentCheckpoint {
     sessionId: string;
     roundIndex: number;
     llmMessages: AgentLlmMessage[];  // full conversation context at checkpoint
     toolCallsHistory: IAgentToolCall[];  // accumulated tool calls
     roundsUsed: number;
     reasoningTokenCount: number | null;
     intent: IIntent | null;
   }
   ```
2. Implement `saveCheckpoint(sessionId, checkpoint)` -- serialize to JSON, write to `agent_sessions.checkpoint_json`
3. Implement `loadCheckpoint(sessionId)` -- deserialize from DB
4. Modify `runAgentFlow()` to:
   - Load checkpoint at start (if exists)
   - Save checkpoint before each `streamChatCompletion()` call
   - Save checkpoint after each tool execution batch
   - On error, set session status to `waiting_retry` with checkpoint preserved
5. Add `AGENT_RESUME` IPC handler that loads checkpoint and continues execution

**Acceptance criteria**:
- Checkpoint saved before every LLM call and after every tool execution
- App crash during LLM call: on restart, session can be resumed from last checkpoint
- Resume preserves all tool call history and message context
- Checkpoint data is valid JSON and round-trips correctly

---

### P0-3: Structured Question Cards / ClarifyDrawer (C2)

**Goal**: Agent can ask structured clarifying questions via `ask_question_card` tool; user answers inline.

**Files to create**:
- `src/render/components/AIAgent/ClarifyDrawer.tsx` -- Multi-question card component with conditional dependencies
- `src/main/ai/tools/askQuestionCard.ts` -- Tool definition and execution

**Files to modify**:
- `src/main/ai/toolRegistry.ts` -- Register `ask_question_card` tool
- `src/render/stores/agentStore.ts` -- Add `pendingQuestions` state, `answerQuestion()` action
- `src/render/components/AIAgent/AgentTab.tsx` -- Render ClarifyDrawer when questions pending
- `src/main/ai/agentLoop.ts` -- Handle `ask_question_card` tool result: set session to `waiting_interaction`
- `src/shared/ai.ts` -- Add `IClarifyQuestion`, `IClarifySession` types

**Implementation steps**:
1. Define types:
   ```typescript
   interface IClarifyQuestion {
     id: string;
     text: string;
     type: 'text' | 'choice' | 'confirm';
     options?: string[];  // for choice type
     dependsOn?: string;  // question ID dependency
     condition?: string;  // answer value that triggers this question
   }
   interface IClarifySession {
     questions: IClarifyQuestion[];
     answers: Record<string, string>;
     phase: 'asking' | 'answered' | 'expired';
   }
   ```
2. Implement `ask_question_card` tool in toolRegistry:
   - LLM provides questions JSON as tool arguments
   - Tool returns structured question set
   - Agent loop detects this tool result and sets session to `waiting_interaction`
3. Create `ClarifyDrawer.tsx`:
   - Renders questions as inline cards in the message stream
   - Supports text input, choice buttons, confirm/deny
   - Conditional questions shown only when dependency met
   - Submit button sends all answers back as a new message
4. Wire answers back through `agentStore.answerQuestion()` which resumes the session

**Acceptance criteria**:
- Agent can call `ask_question_card` with 1-5 questions
- Questions render as inline cards below the assistant message
- Conditional questions appear/disappear based on answers
- Submitting answers resumes the agent session
- Session status correctly transitions: running -> waiting_interaction -> running

---

### P0-4: Persistent Task Queue (A1)

**Goal**: Background task execution via SQLite FIFO queue; same-conversation tasks run serially.

**Files to create**:
- `src/main/ai/agentTaskQueue.ts` -- Enqueue, dequeue, status management
- `src/main/ai/agentTaskWorker.ts` -- Polling worker (1s interval), task execution orchestration
- `src/main/db/agentTaskDao.ts` -- CRUD for agent_task_queue table

**Files to modify**:
- `src/main/ai/ipc/agentHandlers.ts` -- `AGENT_RUN` now enqueues instead of executing directly
- `src/main/ai/ipc/index.ts` -- Register new handlers
- `src/main/ai/agentLoop.ts` -- Called by worker, not directly by IPC

**Implementation steps**:
1. Create `agentTaskDao.ts`:
   - `enqueueTask(conversationId, userId, message, payloadJson)` -- INSERT with status='pending'
   - `dequeueNext()` -- SELECT oldest pending task where no other task for same conversation is 'running'
   - `updateTaskStatus(taskId, status, errorCode?, errorMessage?)` -- UPDATE
   - `getTaskById(taskId)` -- SELECT
   - `cancelPendingByConversation(conversationId)` -- UPDATE status='cancelled' WHERE status='pending'
2. Create `agentTaskQueue.ts`:
   - `enqueue(payload)` -- calls dao.enqueueTask, returns taskId
   - `dequeueForProcessing()` -- calls dao.dequeueNext, checks same-conversation serial constraint
3. Create `agentTaskWorker.ts`:
   - `startWorker()` -- starts 1s interval polling
   - `stopWorker()` -- clears interval
   - Each tick: `dequeueForProcessing()` -> if task found, create session, call `runAgentFlow()`, update status
   - Handles AbortController lifecycle
   - Emits task completion/failure events
4. Modify `agentHandlers.ts`:
   - `AGENT_RUN` handler now calls `enqueue()` and returns immediately with `{ taskId, status: 'queued' }`
   - Add `AGENT_TASK_STATUS` handler for polling task progress
   - Worker pushes SSE events via existing channels

**Acceptance criteria**:
- Sending a message enqueues a task and returns immediately
- Tasks for the same conversation execute serially (no overlap)
- Tasks for different conversations can run in parallel
- Worker polls every 1 second and processes pending tasks
- App restart: pending tasks in DB are picked up by new worker

---

### P0-5: preview_patch_files Tool (B5)

**Goal**: Multi-file old/new patch preview for batch file modifications.

**Files to create**:
- `src/main/ai/tools/previewPatchFiles.ts` -- Tool definition and execution
- `src/render/components/AIAgent/PatchPreviewDialog.tsx` -- Left file list + right diff view

**Files to modify**:
- `src/main/ai/toolRegistry.ts` -- Register new tool
- `src/render/stores/agentStore.ts` -- Add `pendingPatches` state
- `src/render/components/AIAgent/AgentTab.tsx` -- Render PatchPreviewDialog
- `src/shared/ai.ts` -- Add `IPatchFile`, `IPatchPreview` types

**Implementation steps**:
1. Define types:
   ```typescript
   interface IPatchFile {
     filePath: string;
     oldContent: string;
     newContent: string;
   }
   interface IPatchPreview {
     files: IPatchFile[];
     status: 'pending' | 'applied' | 'discarded' | 'rolled_back';
   }
   ```
2. Implement `preview_patch_files` tool:
   - LLM provides array of `{file_path, old_content, new_content}` as arguments
   - Tool validates file paths exist, returns structured patch preview
   - Returns `{proposal: true, patches: [...]}` (proposal pattern, same as createFile)
3. Create `PatchPreviewDialog.tsx`:
   - Left panel: file list with status indicators (pending/applied/discarded)
   - Right panel: unified diff view (old vs new content)
   - Apply All / Apply Selected / Discard buttons
   - Apply triggers actual file writes via `window.weaveMD.file.write`
4. Wire to agentStore: detect `preview_patch_files` tool result, add to `pendingPatches`

**Acceptance criteria**:
- Agent calls `preview_patch_files` with multiple file patches
- Preview dialog shows left file list + right diff for each file
- User can apply individual patches or all at once
- Applied patches write files to disk
- Discarded patches are removed from the list

---

### P0-6: File Snapshot + Rollback (A8)

**Goal**: Snapshot all .md files at session creation; support one-click rollback.

**Files to create**:
- `src/main/ai/agentSnapshot.ts` -- Snapshot creation and rollback logic
- `src/main/db/agentSnapshotDao.ts` -- CRUD for agent_file_snapshots table

**Files to modify**:
- `src/main/ai/agentTaskWorker.ts` -- Create snapshot when session starts
- `src/main/ai/ipc/agentHandlers.ts` -- Add `AGENT_ROLLBACK` IPC handler
- `src/render/stores/agentStore.ts` -- Add `rollbackSession()` action
- `src/render/components/AIAgent/AgentTab.tsx` -- Add rollback button in session header

**Implementation steps**:
1. Create `agentSnapshotDao.ts`:
   - `saveSnapshot(sessionId, userId, files[])` -- batch INSERT
   - `getSnapshot(sessionId)` -- SELECT all files for session
   - `deleteSnapshot(sessionId)` -- DELETE
2. Create `agentSnapshot.ts`:
   - `createSnapshot(sessionId, userId)` -- list all .md files for user, save content to DB
   - `rollbackToSnapshot(sessionId, userId)` -- load snapshot, write each file back via file operations
3. Modify `agentTaskWorker.ts`: call `createSnapshot()` before starting agent loop
4. Add `AGENT_ROLLBACK` IPC handler:
   - Validates session ownership
   - Calls `rollbackToSnapshot()`
   - Returns list of restored files
5. Add rollback button to session header in AgentTab

**Acceptance criteria**:
- Snapshot created automatically when agent session starts
- Snapshot includes all user .md files with full content
- Roll button restores all files to snapshot state
- Rollback is atomic (all files restored or none)
- Snapshot storage uses reasonable space (content hash dedup optional)

---

## 3. P1 -- Important Enhancements (8 items)

### P1-1: SSE Event Persistence (A3)

**Goal**: Persist all SSE events to DB; enable incremental replay on reconnect.

**Files to create**:
- `src/main/ai/agentEventStore.ts` -- Event persistence and replay logic
- `src/main/db/agentEventDao.ts` -- CRUD for agent_run_events table

**Files to modify**:
- `src/main/ai/ipc/shared.ts` -- `sendStream()` wrapper now persists before push
- `src/main/ai/ipc/agentHandlers.ts` -- Add `AGENT_EVENTS_REPLAY` handler
- `src/render/stores/agentStore.ts` -- Add reconnect replay logic
- `src/shared/constants.ts` -- Add `AGENT_EVENTS_REPLAY` channel

**Implementation steps**:
1. Create `agentEventDao.ts`:
   - `insertEvent(sessionId, conversationId, seq, eventType, payloadJson)` -- INSERT
   - `getEventsAfterSeq(sessionId, afterSeq)` -- SELECT WHERE seq > afterSeq
   - `getLatestSeq(sessionId)` -- SELECT MAX(seq)
2. Create `agentEventStore.ts`:
   - `persistAndSend(event, sessionId, seq)` -- write to DB then send via webContents
   - `replayFromSeq(sessionId, afterSeq)` -- load events from DB, send batch
3. Modify `sendStream()` in shared.ts: inject event persistence
4. Add `AGENT_EVENTS_REPLAY` IPC: render-side calls with `(sessionId, lastSeq)`, gets batch of missed events
5. Render-side: on SSE reconnect, call replay endpoint with last received seq

**Acceptance criteria**:
- Every SSE event (chunk, tool, done, error, state_change) is persisted to DB before push
- After page refresh, missed events are replayed in order
- Replay is incremental (only events after last received seq)
- Old events can be cleaned up (configurable retention, e.g., 7 days)

---

### P1-2: Task Supersede Mechanism (A6)

**Goal**: New message cancels old waiting-state tasks for the same conversation.

**Files to modify**:
- `src/main/ai/agentTaskQueue.ts` -- Add `supersedePending()` logic
- `src/main/ai/agentTaskWorker.ts` -- Check for superseded tasks before executing
- `src/main/db/agentTaskDao.ts` -- `cancelByConversationId()` and `supersedeTask()`

**Implementation steps**:
1. In `agentTaskQueue.enqueue()`:
   - Before inserting new task, find all tasks for same conversation with status in ('pending', 'running')
   - If found and status is 'pending': set status='superseded'
   - If found and status is 'running': set a flag so the running task checks for supersede on next checkpoint
2. In `agentTaskWorker`:
   - Before each checkpoint save, check if task has been superseded
   - If superseded: abort controller, set session status to 'cancelled', stop processing
3. Add `AGENT_TASK_CANCEL` IPC handler for explicit user cancellation

**Acceptance criteria**:
- Sending a new message while a previous task is pending cancels the old one
- Sending a new message while a previous task is running: old task is aborted at next checkpoint
- Superseded tasks are marked with status='superseded' in DB
- UI reflects cancelled/superseded status

---

### P1-3: Dead Loop Detection (A7)

**Goal**: Prevent agent from running infinitely by detecting repeated results or consecutive failures.

**Files to create**:
- `src/main/ai/agentLoopGuard.ts` -- Detection logic

**Files to modify**:
- `src/main/ai/agentLoop.ts` -- Integrate guard checks after each round

**Implementation steps**:
1. Create `agentLoopGuard.ts`:
   - `DeadLoopDetector` class with:
     - `checkSameResult(resultHash: string)` -- returns true if same result seen 3 consecutive times
     - `checkConsecutiveFailure(toolName: string)` -- returns true if same tool failed 2 consecutive times
     - `checkRoundLimit(roundsUsed, maxRounds)` -- returns true if at limit
   - Hash tool results using simple string hash for comparison
2. Integrate into agent loop:
   - After each tool execution: call `checkSameResult()` and `checkConsecutiveFailure()`
   - If detected: set session status to 'failed' with descriptive error, break loop
3. Replace hardcoded `MAX_ROUNDS = 6` with configurable limit (default 20, matching Notus)

**Acceptance criteria**:
- Same tool result 3 times in a row: agent stops with "detected repeated result" message
- Same tool failure 2 times in a row: agent stops with "detected consecutive failure" message
- Round limit configurable (default 20)
- Detection is per-session, resets on new session

---

### P1-4: Web Search Integration (B2)

**Goal**: Inject existing `searchClient.ts` as an agent tool.

**Files to create**:
- `src/main/ai/tools/webSearch.ts` -- Tool definition wrapping searchClient

**Files to modify**:
- `src/main/ai/toolRegistry.ts` -- Register `web_search` tool
- `src/main/ai/agentLoop.ts` -- Provide search config to tool context
- `src/main/ai/ipc/agentHandlers.ts` -- Load search config and pass to agent flow
- `src/shared/ai.ts` -- Add `web_search` to tool types if needed

**Implementation steps**:
1. Define `web_search` tool:
   - Parameters: `{query: string, max_results?: number}`
   - Execution: call `search()` from `searchClient.ts` with user's configured provider and API key
   - Returns: array of `{title, url, snippet}` results
2. Load search config from `ai_search_config` table in agentHandlers
3. Pass search config to tool context (new field `searchConfig` in `ToolCtx`)
4. In `toolsForIntent()`: include `web_search` tool when:
   - Intent is 'web' OR
   - User explicitly requests web search OR
   - Search config is enabled
5. Handle search errors gracefully (timeout, auth failure) with tool error response

**Acceptance criteria**:
- `web_search` tool appears in tool list when search is configured
- Agent can call web_search and receive structured results
- Search results are passed back to LLM as tool response
- Search errors are handled gracefully without crashing the loop
- User's search provider preference is respected

---

### P1-5: analyze_folder Tool (B9)

**Goal**: Analyze directory structure and return summary.

**Files to create**:
- `src/main/ai/tools/analyzeFolder.ts` -- Tool definition

**Files to modify**:
- `src/main/ai/toolRegistry.ts` -- Register tool
- `src/main/db/files.ts` -- Add `listFilesByPath()` query if not exists

**Implementation steps**:
1. Define `analyze_folder` tool:
   - Parameters: `{folder_path: string}`
   - Execution: list files in directory, build tree structure, calculate stats (file count, total size, file types)
   - Returns: JSON with directory tree, file count, size distribution, file type breakdown
2. Use existing `listFiles` DB query filtered by path prefix
3. Handle non-existent paths with error response

**Acceptance criteria**:
- Agent can call analyze_folder with a directory path
- Returns structured directory analysis (tree, stats, file types)
- Non-existent paths return descriptive error
- Large directories are handled without performance issues (limit to 200 files)

---

### P1-6: Mention Preview Popup (C5)

**Goal**: @ reference shows preview popup for files, directories, and Skills.

**Files to create**:
- `src/render/components/AIAgent/MentionPreview.tsx` -- Preview popup component

**Files to modify**:
- `src/render/components/AIAgent/CompletionMenu.tsx` -- Add preview trigger on hover/select
- `src/render/stores/agentStore.ts` -- Add mention preview cache

**Implementation steps**:
1. Create `MentionPreview.tsx`:
   - File preview: show first 500 chars of file content, metadata (size, modified date)
   - Directory preview: show file tree (first 2 levels), file count
   - Skill preview: show skill description and parameters
   - Positioned as floating popup near the @ mention
2. Add preview cache in agentStore (Map<type+id, previewData>)
3. Trigger preview on CompletionMenu item hover (debounced 300ms)
4. Prefetch previews for visible CompletionMenu items

**Acceptance criteria**:
- Hovering over @ file mention shows file content preview
- Hovering over @ directory mention shows directory tree
- Hovering over @ Skill mention shows skill description
- Preview is cached and does not re-fetch on repeated hover
- Preview popup dismisses on click outside or Escape

---

### P1-7: Conversation Export (C9)

**Goal**: Export conversation as Markdown file.

**Files to create**:
- `src/main/ai/conversationExport.ts` -- Export logic

**Files to modify**:
- `src/main/ai/ipc/chatHandlers.ts` -- Add `AI_CONVERSATION_EXPORT` handler
- `src/render/stores/agentStore.ts` -- Add `exportConversation()` action
- `src/render/components/AIAgent/AIAgentPanel.tsx` -- Add export button in history view
- `src/shared/constants.ts` -- Add IPC channel

**Implementation steps**:
1. Create `conversationExport.ts`:
   - `exportToMarkdown(conversationId, userId)` -- loads conversation + messages, formats as Markdown
   - Format: title (from summary), date, then alternating user/assistant messages with timestamps
   - Tool calls included as collapsible sections
2. Add IPC handler `AI_CONVERSATION_EXPORT`
3. Add export button in conversation history view
4. Use existing `dialog:saveFile` to let user choose save location

**Acceptance criteria**:
- Export produces valid Markdown with all messages
- Tool calls shown in collapsible details sections
- User can choose save location via file dialog
- Export includes conversation metadata (title, date, message count)

---

### P1-8: Conversation Search (D4)

**Goal**: Search conversations by title or message content.

**Files to modify**:
- `src/main/db/ai.ts` -- Add `searchConversations()` query
- `src/main/ai/ipc/chatHandlers.ts` -- Add `AI_CONVERSATION_SEARCH` handler
- `src/render/stores/agentStore.ts` -- Add `searchConversations()` action
- `src/render/components/AIAgent/AIAgentPanel.tsx` -- Add search input in history view
- `src/shared/constants.ts` -- Add IPC channel

**Implementation steps**:
1. Add `searchConversations(userId, query, mode?)` to `db/ai.ts`:
   - Search in `ai_conversations.summary` and `ai_messages.content`
   - Return matching conversations with relevance ranking
   - Use LIKE for simplicity (FTS5 optional enhancement)
2. Add IPC handler
3. Add search input field in history view of AIAgentPanel
4. Debounced search (300ms) with results replacing the default list

**Acceptance criteria**:
- Typing in search field filters conversations by title and message content
- Results update as user types (debounced)
- Search is case-insensitive
- Empty search shows all conversations (default behavior)

---

## 4. P2 -- Nice to Have (7 items)

### P2-1: Conversation History Rewrite (A9)

**Goal**: Editing a message deletes subsequent messages and cancels subsequent tasks.

**Files to modify**:
- `src/main/db/ai.ts` -- Add `deleteMessagesAfter(conversationId, messageId)` and `deleteMessagesFromIndex(conversationId, seq)`
- `src/main/ai/ipc/chatHandlers.ts` -- Add `AI_MESSAGE_EDIT` handler
- `src/render/stores/agentStore.ts` -- Add `editMessage()` action
- `src/render/components/AIAgent/AgentTab.tsx` -- Wire edit button to new action

**Implementation steps**:
1. Add DB function: delete all messages for conversation where created_at > target message's created_at
2. Add IPC handler: validates ownership, deletes subsequent messages, cancels subsequent tasks
3. Render-side: edit button on user messages opens inline editor, submit triggers IPC
4. After edit: reload conversation messages from DB

**Acceptance criteria**:
- Editing a user message deletes all subsequent messages
- Any pending/running tasks for subsequent messages are cancelled
- UI updates to show only messages up to and including the edited one
- Edited message content is updated in DB

---

### P2-2: check_links Tool (B10)

**Files to create**: `src/main/ai/tools/checkLinks.ts`

**Implementation**: Parse markdown content for internal links (`[text](path)`), check if target files exist in DB. Return list of broken links with source location.

---

### P2-3: get_task_activity Tool (B11)

**Files to create**: `src/main/ai/tools/getTaskActivity.ts`

**Implementation**: Query `agent_sessions` and `agent_task_queue` for conversation history. Return task execution timeline with durations, tool calls, and outcomes.

---

### P2-4: Model Selector Search (C7)

**Files to modify**: `src/render/components/AIAgent/ModelDropdown.tsx`

**Implementation**: Add text input at top of dropdown. Filter model list by name, provider, or config name matching input. Debounced filtering.

---

### P2-5: soul.md / memory.md / style.md (D1)

**Files to create**: `src/main/ai/globalAgentFiles.ts`, `src/main/db/agentGlobalFilesDao.ts`

**New table**: `agent_global_files` (id, user_id, file_type [soul|memory|style], content, version, created_at, updated_at)

**Implementation**: Store personalized files per user. Inject into agent system prompt. Support version history and rollback.

---

### P2-6: Skill Installation Source Extension (D2)

**Files to modify**: `src/main/ai/skillLoader.ts`, `src/render/components/AIAgent/settings/SkillsPanel.tsx`

**Implementation**: Add Git clone and ZIP extraction support for skill installation. Extend `loadUserSkillsFromDirs()` to handle git repos and zip archives.

---

### P2-7: MCP Server (D3)

**Files to create**: `src/main/ai/mcpServer.ts`

**Implementation**: Expose WeaveMD as a Streamable HTTP MCP Server. Implement MCP protocol handlers for note read/write tools. Token-based authentication.

---

## 5. New IPC Channels Summary

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `AGENT_TASK_ENQUEUE` | render -> main | Enqueue new task (replaces AGENT_RUN synchronous) |
| `AGENT_TASK_STATUS` | render -> main | Query task status |
| `AGENT_TASK_CANCEL` | render -> main | Cancel running/pending task |
| `AGENT_SESSION_STATUS` | render -> main | Query session state |
| `AGENT_SESSION_RESUME` | render -> main | Resume from checkpoint |
| `AGENT_EVENTS_REPLAY` | render -> main | Replay missed SSE events |
| `AGENT_ROLLBACK` | render -> main | Rollback to file snapshot |
| `AI_CONVERSATION_EXPORT` | render -> main | Export conversation as Markdown |
| `AI_CONVERSATION_SEARCH` | render -> main | Search conversations |
| `AI_MESSAGE_EDIT` | render -> main | Edit message + delete subsequent |

Note: The existing `AGENT_RUN` channel will be repurposed. Instead of executing synchronously and returning a result, it will enqueue a task and return `{taskId, status: 'queued'}`. The actual results come via existing SSE channels (`AI_STREAM_CHUNK`, `AI_STREAM_TOOL`, `AI_STREAM_DONE`, `AI_STREAM_ERROR`). This is backward-compatible because the render-side already listens for SSE events.

---

## 6. File Structure Summary

### New files to create:

```
src/main/ai/
  agentSession.ts           -- Session state machine
  agentTaskQueue.ts         -- Task queue management
  agentTaskWorker.ts        -- Background worker (1s polling)
  agentCheckpoint.ts        -- Checkpoint save/load
  agentEventStore.ts        -- SSE event persistence + replay
  agentSnapshot.ts          -- File snapshot + rollback
  agentLoopGuard.ts         -- Dead loop detection
  conversationExport.ts     -- Conversation export to Markdown
  globalAgentFiles.ts       -- soul.md / memory.md / style.md (P2)
  mcpServer.ts              -- MCP Server (P2)
  tools/
    askQuestionCard.ts      -- ask_question_card tool
    previewPatchFiles.ts    -- preview_patch_files tool
    webSearch.ts            -- web_search tool
    analyzeFolder.ts        -- analyze_folder tool
    checkLinks.ts           -- check_links tool (P2)
    getTaskActivity.ts      -- get_task_activity tool (P2)

src/main/db/
  agentTaskDao.ts           -- agent_task_queue CRUD
  agentSessionDao.ts        -- agent_sessions CRUD
  agentEventDao.ts          -- agent_run_events CRUD
  agentSnapshotDao.ts       -- agent_file_snapshots CRUD
  agentGlobalFilesDao.ts    -- agent_global_files CRUD (P2)

src/render/components/AIAgent/
  ClarifyDrawer.tsx         -- Structured question cards
  PatchPreviewDialog.tsx    -- Multi-file patch preview
  MentionPreview.tsx        -- @ mention preview popup

src/shared/ai.ts            -- Extended with new types (additions only)
src/shared/constants.ts     -- Extended with new IPC channels (additions only)
```

### Files to modify:

```
src/main/db/index.ts              -- Add new table DDL in runMigrations()
src/main/ai/agentLoop.ts          -- Complete rewrite (queue + checkpoint + guard)
src/main/ai/toolRegistry.ts       -- Register 4+ new tools
src/main/ai/ipc/agentHandlers.ts  -- Repurpose AGENT_RUN, add new handlers
src/main/ai/ipc/shared.ts         -- sendStream() with event persistence
src/main/ai/ipc/index.ts          -- Register new handlers
src/main/ai/ipc/chatHandlers.ts   -- Add export/search/edit handlers
src/main/preload.ts               -- Add new IPC bridge methods
src/render/stores/agentStore.ts   -- New states + actions for queue/session/checkpoint
src/render/components/AIAgent/AgentTab.tsx    -- Render new UI elements
src/render/components/AIAgent/AIAgentPanel.tsx -- Add search/export/rollback
src/render/components/AIAgent/CompletionMenu.tsx -- Add mention preview
src/render/components/AIAgent/ModelDropdown.tsx  -- Add search filter
tests/setup.ts                    -- Add mock methods for new IPC channels
```

---

## 7. Implementation Sequence

The work should be done in this order to manage dependencies:

**Phase 1: Foundation (P0-1 + P0-4 + DB Schema)**
1. DB schema changes (all new tables in `db/index.ts`)
2. DAO layer (`agentTaskDao.ts`, `agentSessionDao.ts`)
3. Session state machine (`agentSession.ts`)
4. Task queue (`agentTaskQueue.ts`)
5. Task worker (`agentTaskWorker.ts`)
6. Repurpose `AGENT_RUN` IPC to enqueue

**Phase 2: Resilience (P0-2 + P0-6 + P1-1 + P1-3)**
7. Checkpoint system (`agentCheckpoint.ts`)
8. File snapshot + rollback (`agentSnapshot.ts`, `agentSnapshotDao.ts`)
9. SSE event persistence (`agentEventStore.ts`, `agentEventDao.ts`)
10. Dead loop detection (`agentLoopGuard.ts`)

**Phase 3: New Tools (P0-3 + P0-5 + P1-4 + P1-5)**
11. `ask_question_card` tool + ClarifyDrawer
12. `preview_patch_files` tool + PatchPreviewDialog
13. `web_search` tool integration
14. `analyze_folder` tool

**Phase 4: UX Enhancements (P1-2 + P1-6 + P1-7 + P1-8)**
15. Task supersede mechanism
16. Mention preview popup
17. Conversation export
18. Conversation search

**Phase 5: P2 Features**
19. Conversation history rewrite
20. check_links / get_task_activity tools
21. Model selector search
22. soul.md / memory.md / style.md
23. Skill installation sources
24. MCP Server

---

## 8. Testing Strategy

### 8.1 Unit Tests (Vitest, existing pattern)

Each new module gets a corresponding test file following the existing pattern in `tests/main/ai/`:

| Module | Test File | Key Test Cases |
|--------|-----------|----------------|
| `agentSession.ts` | `tests/main/ai/agentSession.test.ts` | All state transitions, illegal transition rejection, DB persistence |
| `agentTaskQueue.ts` | `tests/main/ai/agentTaskQueue.test.ts` | Enqueue/dequeue, same-conversation serial, supersede |
| `agentTaskWorker.ts` | `tests/main/ai/agentTaskWorker.test.ts` | Worker polling, task execution, error handling |
| `agentCheckpoint.ts` | `tests/main/ai/agentCheckpoint.test.ts` | Save/load roundtrip, corruption handling |
| `agentEventStore.ts` | `tests/main/ai/agentEventStore.test.ts` | Persist + replay, incremental replay |
| `agentSnapshot.ts` | `tests/main/ai/agentSnapshot.test.ts` | Snapshot creation, rollback correctness |
| `agentLoopGuard.ts` | `tests/main/ai/agentLoopGuard.test.ts` | Same result detection, failure detection |
| `askQuestionCard.ts` | `tests/main/ai/tools/askQuestionCard.test.ts` | Question parsing, conditional deps |
| `previewPatchFiles.ts` | `tests/main/ai/tools/previewPatchFiles.test.ts` | Patch validation, multi-file handling |
| `webSearch.ts` | `tests/main/ai/tools/webSearch.test.ts` | Provider dispatch, error handling |
| `analyzeFolder.ts` | `tests/main/ai/tools/analyzeFolder.test.ts` | Directory analysis, edge cases |
| New DAO modules | `tests/main/db/agentDao.test.ts` | CRUD operations, constraint violations |

### 8.2 Integration Tests

- Full agent flow: enqueue -> worker picks up -> session created -> checkpoint saved -> tools executed -> completed
- Supersede flow: enqueue task A -> enqueue task B -> task A cancelled
- Checkpoint resume: crash simulation -> restart -> resume from checkpoint
- Event replay: disconnect -> reconnect -> replay missed events

### 8.3 E2E Tests (Playwright or manual)

- Send message -> agent responds with tool calls -> verify UI shows tool timeline
- Agent asks question -> user answers -> agent resumes
- File snapshot -> agent modifies files -> rollback -> files restored
- Web search integration -> agent searches -> results shown in response

### 8.4 Coverage Target

- Unit test coverage: >= 80% for all new modules
- Integration test coverage: all critical paths (enqueue, execute, checkpoint, resume, rollback)
- No regression: all existing tests must continue to pass

---

## 9. Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|------------|
| agentLoop rewrite breaks all AI functionality | HIGH | Phase-by-phase replacement; keep old `runAgentFlow()` signature as compatibility layer; test each phase independently |
| SQLite schema migration fails on existing databases | HIGH | All tables use CREATE TABLE IF NOT EXISTS; all columns use addColumnIfMissing pattern (already proven in codebase); migration is additive only |
| SSE event persistence increases storage | MEDIUM | Configurable retention (default 7 days); cleanup job removes old events; events are JSON, not binary |
| Checkpoint serialization of large message arrays | MEDIUM | Limit checkpoint size (truncate old messages, keep summary + recent N rounds); use same compression as contextManager |
| File snapshot storage for large workspaces | MEDIUM | Only snapshot .md files; dedup by content hash; configurable snapshot scope (all files vs. referenced files only) |
| Worker thread blocking main process | MEDIUM | Worker runs on main process with 1s polling interval (lightweight); actual LLM calls are async; AbortController for cancellation |
| Frontend component migration breaks existing UI | MEDIUM | New components are additive (ClarifyDrawer, PatchPreviewDialog); existing components modified minimally; old components preserved during transition |

---

## 10. Unresolved Questions (from requirements doc)

1. **Checkpoint serialization format**: JSON (simpler, debuggable) vs MessagePack (compact). Recommendation: JSON for v1, optimize later if needed.
2. **File snapshot scope**: All .md files vs. only files referenced in conversation. Recommendation: all .md files for simplicity; scope can be narrowed later.
3. **SSE event retention**: Default 7 days, configurable. Cleanup runs on app start.
4. **Max rounds**: Default 20 (up from 6), configurable per session.
5. **Lease mechanism**: 90s lease + 20s renewal. Recommendation: implement in Phase 2 (P0-2) alongside checkpoint, as it requires the same session state infrastructure.

### Critical Files for Implementation
- `D:\software\WeaveMD\src\main\ai\agentLoop.ts`
- `D:\software\WeaveMD\src\main\db\index.ts`
- `D:\software\WeaveMD\src\render\stores\agentStore.ts`
- `D:\software\WeaveMD\src\main\ai\ipc\agentHandlers.ts`
- `D:\software\WeaveMD\src\shared\ai.ts`
