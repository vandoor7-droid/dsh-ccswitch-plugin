# cc-switch 4.0.6 · 写引擎盘点（已退役 · 仅供参考）

> ## ⚠️ 状态：已退役
>
> 按 v2 计划**决策 #5**，外部工具写入器全家已从本仓删除，包括 `src/host/writers.js`（1735 行）、
> `POST /api/dsh-ccswitch-manager/writers/run` 路由，以及 floor / residue / exclusive / `mode/operation.rs`
> 协议与首写备份语义。2026-10-10 保真度审计确认的两个 Codex 高危缺口
> （`CODEX_FLOOR_TOP` 清空缺失、`CODEX_EXCLUSIVE_TOP` 缺失）**一并标记为不适用**，不再补。
>
> **保留本文仅作对照 cc-switch 原实现的参考，不得据此恢复任何写入路径。**
>
> 仍然生效的只有键表本身：`lib/core/claude-exclusive.js` 中的 `CLAUDE_EXCLUSIVE_ENV`
> 现在只用来回答「哪些 `env` 键属于这个 provider」，即导入时把它们收进 `exclusiveEnv` 以保证往返不丢；
> 它不再写入、也不再删除任何文件。
>
> 首写备份的思想并未丢弃——它转到了数据面（`services/sync_protocol.rs` 的备份/恢复，见 M5）。

---

# CC Switch v4.0.6 — Per-App Live-Config Write Engine: Exhaustive Inventory

Source root: `C:/Users/15726/AppData/Local/Temp/cc-switch-src/src-tauri/src/`
(All paths below are relative to that root unless absolute.)

---

## 0. The real app list

`app_config.rs:456-470` — `AppType::all()`:

```rust
[ AppType::Claude, AppType::ClaudeDesktop, AppType::Codex, AppType::Gemini,
  AppType::GrokBuild, AppType::OpenCode, AppType::OpenClaw, AppType::Hermes,
  AppType::Pi, AppType::Mcode ]
```

`app_config.rs:441-446`:
```rust
pub fn is_additive_mode(&self) -> bool {
    matches!(self, AppType::OpenCode | AppType::OpenClaw | AppType::Hermes | AppType::Pi | AppType::Mcode)
}
```
`app_config.rs:448-453` — `supports_local_proxy()` = `Claude | Codex | Gemini | GrokBuild`.

**Two families:**
| Family | Apps | Writer |
|---|---|---|
| **Switch-type** (floor clear + residue + exclusive) | `claude`, `codex`, `gemini`, `grokbuild` | `live/*` engine, one `*_direct.rs` each |
| **Desktop** | `claude-desktop` | `claude_desktop_config.rs`, but *does* use `live::engine` + `JsonPatch` |
| **Additive** | `opencode`, `openclaw`, `hermes`, `pi`, `mcode` | own `*_config.rs`, `atomic_write`/`atomic_write_private`, **no** `live::engine`, no floor |

There is **no** `live/project/` module for opencode/pi/claude-desktop/etc. `live/project/mod.rs` (9 lines) declares exactly:

```rust
pub mod claude;
pub mod codex;
pub mod gemini;
pub mod grok;
```

`services/provider/live.rs:525-701` — `write_live_snapshot()` hard-errors for the switch apps:
```rust
AppType::Claude      => AppError::localized("claude.live.requires_engine",      "Claude Code 配置只能经关键字段写入流程写入", ...)
AppType::Codex       => AppError::localized("codex.live.requires_engine",       ...)
AppType::Gemini      => AppError::localized("gemini.live.requires_engine",      ...)
AppType::GrokBuild   => AppError::localized("grokbuild.live.requires_engine",   ...)
AppType::ClaudeDesktop => AppError::localized("claude_desktop.live.requires_db_context", ...)
AppType::Pi          => Err(AppError::InvalidInput("Pi providers use the Pi provider service"))
```

Dispatch at `services/provider/mod.rs:6586-6600`:
```rust
if matches!(app_type, AppType::Claude)    { return Self::switch_claude_direct(...); }
if matches!(app_type, AppType::Codex)     { return Self::switch_codex_direct(...); }
if matches!(app_type, AppType::Gemini)    { gemini_direct::switch_to(...); return Ok(...); }
if matches!(app_type, AppType::GrokBuild) { return Self::switch_grok_direct(...); }
// else: additive / ClaudeDesktop -> write_live_for_state(...)
```

---

# PART 1 — Shared engine (`live/`)

`live/mod.rs` (13 lines) is the module contract:
> `floor` → 纯函数谓词和常量清单; `project` → 纯函数投影器; `patch` → 按格式保序改写（JSON、TOML、`.env`），解析不了就停; `residue` → 兼容期残留清理（冻结的键值对清单）; `engine` → 写锁、计划、临时文件、首写备份、重读比对.

## 1.1 `live/engine.rs` (321 lines)

### DeviceStore — `~/.cc-switch`
`engine.rs:29-55`:
```rust
pub struct DeviceStore { root: PathBuf }
pub fn for_device() -> Self { Self::at(crate::config::get_home_dir().join(".cc-switch")) }
pub fn state_path(&self) -> PathBuf { self.root.join("live-state.json") }
pub fn file(&self, name: &str) -> PathBuf { self.root.join(name) }
pub fn first_write_backup_dir(&self) -> PathBuf { self.root.join("backups").join("live-first-write") }
```
Doc (`engine.rs:25-28`): path is fixed to `get_home_dir()/.cc-switch` and does **not** follow the config-dir override (override dir may be a cloud-sync dir; write intent + backups are per-device facts).

### LiveFile / private flag
`engine.rs:57-78`:
```rust
pub struct LiveFile { pub path: PathBuf, pub private: bool }
pub fn private(path) -> Self { private: true }
pub fn shared(path)  -> Self { private: false }
```
`engine.rs:150-156` — `stage()`:
```rust
let mode = planned.file.private.then_some(0o600);
stage_write(&planned.file.path, bytes, mode, true).map(Some)
```
(`durable = true` → fsync the temp file so crash recovery can roll forward.)

### Digest / read / plan
- `digest(bytes: Option<&[u8]>) -> Option<String>` — `None` if file absent (`engine.rs:81`).
- `sha256_hex` (`engine.rs:86`).
- `read_current(path)` — `Ok(None)` on `ErrorKind::NotFound`, otherwise `LiveWriteError::Io` (`engine.rs:94-103`).
- `Planned { file, pre, pre_bytes, planned, bytes }` (`engine.rs:107-125`); `is_noop()` ⇔ `pre == planned`; `planned: None` means *delete the file*.
- `plan(file, patch)` / `plan_from(file, patch, pre_bytes)` (`engine.rs:128-146`) — **computes in memory, writes nothing**.

### First-write backup
`engine.rs:158-184`:
```rust
pub fn ensure_first_write_backup(store, path, current) -> Result<(), AppError> {
    let dir = store.first_write_write_dir… // = backups/live-first-write
    let key = digest(Some(path.to_string_lossy().as_bytes())).expect("digest");
    let name = path.file_name()…;
    let backup = dir.join(format!("{}-{name}", &key[..12]));
    let marker = dir.join(format!("{}-{name}.source", &key[..12]));
    if marker.exists() { return Ok(()); }
    if let Some(bytes) = current { atomic_write_private(&backup, bytes)?; }
    atomic_write_private(&marker, path.to_string_lossy().as_bytes())?;
}
```
- keyed by SHA-256 of the **absolute path**, first 12 hex chars + original filename;
- backed up **once per file ever** (`.source` marker gate);
- if the file did not exist before first write, only the `.source` marker is written (content then is CC Switch's own, never backed up);
- both backup and marker are written `0600`.

### Per-app write lock
`engine.rs:199-224`:
```rust
fn lock_table() -> &'static (Mutex<HashSet<String>>, Condvar)
pub fn lock_app(app: &str) -> AppWriteGuard   // non-reentrant, blocks on Condvar
```
Held by switch / editor / mode operation / tray writers of that app.

## 1.2 `mode/operation.rs` (1197 lines) — the actual read/parse/stage/publish/re-read flow

Doc header `operation.rs:1-16` (paraphrased into the invariants):
- failure **before** publish → nothing changes (parse failure, route validation failure, concurrent conflict);
- once publishing starts → roll forward from `pending`;
- recovery compares current content vs `pre` and `planned` hashes per file.

`const MAX_REPLANS: usize = 3;` — `operation.rs:33`.

`operation::run(store, guard, op, changes, target, commit_target)` — `operation.rs:65-205`:

1. **Recover first**: `recover(store, guard, commit_target)?` (`:74`).
2. **Plan all files in memory** — `plan(&change.file, change.patch)`; *any* parse failure aborts, **nothing is written** (`:78-89`). If all plans are no-ops → only `commit_target(&target)` runs, files untouched.
3. **Stage all temp files** (`stage_write`, fsynced). Any staging error → `discard_all(&staged)` and return (`:91-101`).
4. **Record write intent** (`state::set_pending`) with `{op, files:[{path, pre, planned, staged}], target, published:false}`. Failure → discard staged, nothing written (`:104-119`).
5. **Publish one by one** (`:121-194`):
   - `current = read_current(path)` — final re-read;
   - if `digest(current) == planned.pre` → `ensure_first_write_backup(...)`; if `!pending.published`, first set `published=true` and re-persist pending **before** the first rename (so a crash after rename is distinguishable from "not started"); then `publish(&pending.files[index])` = `commit_staged(tmp, path)` or `delete_file(path)`;
   - if content changed → `replans += 1`; `> MAX_REPLANS (3)` → `give_up_on_conflict(...)`; else `plan_from(...)` on the new content (re-parse/patch), re-stage, update pending, retry.
   - replan producing a no-op → external write already equals target → discard staged, update pending, break.
   - replan failing (new content unparseable) → if nothing published yet: `drop_unpublished` (whole operation discarded); else leave pending for roll-forward.
6. **Commit state then clear intent**: `commit_target(&pending.target)` (error here becomes "文件已写入，但状态更新失败，将在下次操作或启动时补完"), then `state::set_pending(store, app, None)`.

**`recover()`** — `operation.rs:208-293`: classify each file as `At::Planned` / `At::Pre` / `At::Elsewhere`.
- `!published && no file is Planned` → discard staged + pending → `RecoveryOutcome::Discarded` (or `Abandoned { paths }` if some file is `Elsewhere`).
- otherwise: for every file still at `At::Pre` whose staged temp still hashes to `planned`, back up first-write and publish; files at `Elsewhere` are skipped (`RolledForwardExcept`). Then `commit_target`, then drop pending.

**`recover_before_write`** (`operation.rs:327-344`) — called inside `AppWrite::begin`. If recovery *did* change something (i.e. state moved), it returns `live.recovered_before_write`:
> "上一次没做完的写入刚刚补完，当前状态已经变了。这次什么都没改，请重新操作一次"

**`AppWrite`** (`operation.rs:348-381`): `begin(db, app)` → `DeviceStore::for_device()` + `lock_app(app)` + `recover_before_write`; `.run(op, changes, target)` → `operation::run(...)`.

**`commit_target`** (`operation.rs:411-441`):
- `target.pointer` → `settings::set_current_provider(app_type, Some(id))` **and** `db.set_current_provider(app, id)`;
- `target.state / written / stack` → single `state::update(...)` write of `live-state.json`;
- `mirror_proxy_flag(db, app, mode.is_proxy())`.

**`op` constants** — `mode/state.rs:204-225`: `"switch" | "apply" | "enter" | "exit" | "detach" | "attach" | "route" | "stack" | "catalog"`.

### Optimistic conflict handling (verbatim intent, `engine.rs:8-10`)
> 冲突检测是乐观的：CC Switch 自己的写入方共用 `lock_app` 这把锁，彼此不会覆盖；Claude Code 这类外部进程不参与这把锁，「重读比对」和 rename 之间仍有一个极小的窗口，外部写入恰好落在里面时仍会被覆盖。

`MAX_REPLANS = 3` is the only bounded retry. There is **no** content merge — it's re-plan-on-new-base.

`operation.rs:5-6` also states: failure before publish touches nothing; after publish starts, pending drives roll-forward at "next operation on this app or next startup" (`recover_on_startup`, `operation.rs:457-475`).

## 1.3 `live/patch/mod.rs` (262 lines)

- `KeyPath(Vec<String>)` — segments from root; keys may contain dots (TOML `model."grok-4.5"`) (`:16-46`).
- trait `LivePatch { fn apply(&self, path, pre: Option<&[u8]>) -> Result<Vec<u8>, LiveWriteError>;
  fn apply_file(&self, path, pre) -> Result<Option<Vec<u8]>, _> { self.apply(...).map(Some) } }` (`:49-61`).
  `apply_file == None` ⇒ **delete the file** (e.g. Codex `auth.json`).
- `enum WholeFile { Write(Vec<u8>), Delete }` (`:65-69`) — "CC Switch 整份拥有的文件" (Codex model catalog, managed-account login marker, `auth.json` on switch).
- `struct Guarded { expected_pre: Option<String>, then: WholeFile }` (`:74-97`) — whole-file write that **refuses** if the file changed since planning: `if digest(pre) != expected_pre → LiveWriteError::Conflict`. Used so a CLI that just refreshed `auth.json` is never clobbered.
- `LiveWriteError` variants (`:116-148`):
  - `Parse { path, line, column, message }` (1-based line/column)
  - `Shape { path, key_path, expected }` — "…不是{expected}，为避免覆盖你的配置，没有写入"
  - `Io { path, source }`
  - `Conflict { path }` — "在写入过程中一直被其他程序修改，没有写入"
  - `EditConflict { path, keys }` with `pub const EDIT_CONFLICT_CODE: &str = "LIVE_EDIT_CONFLICT";` (`:151`)
  - `Route { profile, key }` — "Codex 当前生效的 profile \"{profile}\" 覆盖了 {key}"
- `From<LiveWriteError> for AppError` (`:153-213`) — both `Parse` and `Shape` messages end with **"为避免覆盖你的配置，本次没有写入任何文件" / "Nothing was written, so your configuration is unchanged"**.
- `expected_en()`: `"对象"→"an object"`, `"表"→"a table"`, `"数组"→"an array"`.

## 1.4 `live/patch/json.rs` (494 lines)

`JsonPatch` fields (`:26-38`):
```rust
pub clear: Vec<ClearScope>,          // predicate clear; targets kept for in-place set
pub remove: Vec<KeyPath>,            // named-path removal; skipped if in `set`
pub set: Vec<(KeyPath, Value)>,      // in-place or append at end of parent (parents created)
pub seed: Vec<(KeyPath, Value)>,     // write only if missing
pub remove_if: Vec<(KeyPath, Vec<Value>)>,  // delete only if current value matches; skipped if in `set`
```
`ClearScope { parent: KeyPath, is_floor: fn(&str) -> bool }` (`:21-24`).

Semantics (`apply_to`, `:41-101`) — order is **clear → remove → set → seed → remove_if**.

Parsing (`parse`, `:141-181`):
- file absent → `{}` with default style;
- BOM stripped and remembered; blank/whitespace-only file → `{}`;
- `serde_json::from_str` failure → `LiveWriteError::Parse{line: err.line(), column: err.column(), …}`;
- root not an object → `Shape { expected: "对象" }`.

Serialization (`serialize`, `:183-211`) preserves: indent (detected from line 2, `detect_indent` at `:215-225`, falls back to two spaces; mixed space/tab ⇒ default), trailing newline, CRLF, BOM. First write may normalize whitespace/escapes; afterwards byte-stable.

`serde_json` runs with `preserve_order`; deletions use `shift_remove` (never `Map::remove`, which under `preserve_order` behaves as `swap_remove`) — `json.rs:2-5`.

## 1.5 `live/patch/toml.rs` (387 lines)

- `TomlPatch { clear: Vec<TomlClearScope>, remove: Vec<KeyPath>, set: Vec<(KeyPath, Item)>, seed, remove_if }` (`:18-30`).
- blanket `impl<T: TomlDocPatch> LivePatch for T` (`:110-116`): `parse → apply_to → doc.to_string()`.
- `TomlSteps(Vec<&dyn TomlDocPatch>)` (`:119-125`) — apply several patches to the *same* parsed doc (editor changes first, then key fields).
- `parse` (`:134-148`): absent file → empty `DocumentMut`; else `text.parse::<DocumentMut>()` → `LiveWriteError::Parse` with `line_column(text, err.span().start)`.
- `value_text` / `same_value` (`:151-160`) — compares value spellings, **ignoring decor/comments**: *"值相同就算相同，不看两侧的空白和行尾注释"*. This is the exact value-guard used for exclusive-key removal.
- `keep_layout` (`:163-174`) — in-place replacement reuses old decor and table `position`, so lines/tables don't move.
- `shape_error(path, segments)` → `Shape { expected: "表" }`.

## 1.6 `live/patch/dotenv.rs` (228 lines)

`DotenvPatch { clear: Option<fn(&str)->bool>, set: Vec<(String,String)>, remove_if, remove }` (`:9-20`).

`apply` (`:29-114`):
- splits on `\n`, strips `\r`, remembers CRLF; `trailing_newline` = file absent or empty or ends with `\n`;
- `parse_key` (`:136-145`): ignores `#` comments, strips leading `export `, requires `KEY=` with only `[A-Za-z0-9_]`; unrecognized lines kept verbatim;
- **clear**: drop every line whose key matches the floor predicate *unless* the key is in `set` (`:52-58`);
- **set**: rewrite the *first* occurrence in place preserving an `export ` prefix, drop duplicates, append if absent (`:60-84`);
- `remove` drops all lines for that key unless in `set`; `remove_if` compares `unquote(value_of(line))` against the candidate values;
- join with `\r\n` or `\n`; re-append trailing separator only if the file had one and lines are non-empty.
- `entries(text)` (`:119-133`) — read helper: first occurrence position, **last** value wins (matches dotenv semantics).

## 1.7 `live/residue.rs` (65 lines) — the frozen residue table (exactly 7 pairs)

Doc (`:1-12`): residues are (a) defaults CC Switch itself injected in old versions, (b) values written whole-file by old CLI/Lite/old GUI. Frozen (key, value) pairs; every direct projection deletes exact hits, **except keys the target itself will write** (those are overwritten in place). Timeouts/telemetry switches are deliberately not collected.

```rust
pub const CLAUDE_RESIDUE_ENV: &[(&str, &[&str])] = &[
    ("CLAUDE_CODE_MAX_CONTEXT_TOKENS",  &["262144", "372000", "983616"]),
    ("CLAUDE_CODE_AUTO_COMPACT_WINDOW", &["262144", "372000", "1000000"]),
    ("CLAUDE_CODE_MAX_OUTPUT_TOKENS",   &["131072"]),
];
```
(`residue.rs:17-27`) — 3 + 3 + 1 = **7 pairs**; the test `residue_keys_are_provider_exclusive_fields` asserts `pairs == 7` *and* that every key is in `CLAUDE_EXCLUSIVE_ENV` (`:47-56`).

```rust
pub fn residue_values(values: &[&str]) -> Vec<Value>   // residue.rs:30-38
```
→ for each string: the `Value::String`, plus `Value::from(u64)` if it parses as `u64`. So `"131072"` matches both `json!("131072")` and `json!(131072)`.

---

# PART 2 — Per-app floor constants (`live/floor.rs`, 319 lines)

## 2.1 Claude Code

`CLAUDE_PROTOCOL_SELECTORS` (`floor.rs:18-26`) — enumerated, **never** prefix-matched:
```rust
pub const CLAUDE_PROTOCOL_SELECTORS: &[&str] = &[
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_GATEWAY",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
];
```
Doc (`:13-17`): `CLAUDE_CODE_USE_` must not be prefix-matched because the same prefix also holds `USE_POWERSHELL_TOOL`, `USE_NATIVE_FILE_SEARCH`, `USE_COWORK_PLUGINS`, `USE_CCR_V2` (verified against Claude Code 2.1.282). *"预设里出现的 `CLAUDE_CODE_USE_*` 必须在这里。"*

`CLAUDE_FLOOR_ENV_PREFIXES` (`floor.rs:30`):
```rust
pub const CLAUDE_FLOOR_ENV_PREFIXES: &[&str] = &["ANTHROPIC_", "AWS_", "VERTEX_REGION_"];
```
(`ANTHROPIC_*` = address/credential/per-tier model names/custom headers; `AWS_*` = Bedrock region+creds; `VERTEX_REGION_*` = per-model Vertex region.)

`CLAUDE_FLOOR_ENV_KEYS` (`floor.rs:33-45`):
```rust
pub const CLAUDE_FLOOR_ENV_KEYS: &[&str] = &[
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
    "CLOUD_ML_REGION",
    "GOOGLE_APPLICATION_CREDENTIALS",        // Vertex credential path
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
    "CLAUDE_CODE_OAUTH_SCOPES",
    "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
];
```

Predicate `claude_floor_env` (`floor.rs:51-58`):
```rust
pub fn claude_floor_env(key: &str) -> bool {
    CLAUDE_FLOOR_ENV_PREFIXES.iter().any(|prefix| key.starts_with(prefix))
        || CLAUDE_PROTOCOL_SELECTORS.contains(&key)
        || CLAUDE_FLOOR_ENV_KEYS.contains(&key)
        || (key.starts_with("CLAUDE_CODE_SKIP_") && key.ends_with("_AUTH"))
}
```
i.e. the skip-auth rule is **prefix `CLAUDE_CODE_SKIP_` AND suffix `_AUTH`** (mirror in frontend `tests/config/claudeKeyFields.json` under `envSkipAuth = {"prefix":"CLAUDE_CODE_SKIP_","suffix":"_AUTH"}`, asserted at `floor.rs:294-318`).

`CLAUDE_FLOOR_TOP` (`floor.rs:61-81`):
```rust
pub const CLAUDE_FLOOR_TOP: &[&str] = &[
    "apiKeyHelper", "apiBaseUrl", "primaryModel", "smallFastModel",
    "apiKey",                      // legacy Bedrock API Key preset written at top level
    "model",                       // /model choice belongs to the provider that was active
    "fallbackModel",               // model-id -> provider-specific id (e.g. Bedrock ARN)
    "modelOverrides",
    "modelPicker",                 // /model selector row; only in aggregate mode, else not kept
    "advisorModel",                // advisor only works on the Anthropic API
    "awsAuthRefresh", "awsCredentialExport", "gcpAuthRefresh",
];
```
`claude_floor_top(key) = CLAUDE_FLOOR_TOP.contains(&key)` (`floor.rs:83-85`).

Deliberately **not** floor (tests `floor.rs:233-258`): top-level `hooks`, `enabledPlugins`, `permissions`, `statusLine`, `env`; env `CLAUDE_CODE_USE_POWERSHELL_TOOL`, `CLAUDE_CODE_USE_NATIVE_FILE_SEARCH`, `CLAUDE_CODE_USE_COWORK_PLUGINS`, `CLAUDE_CODE_USE_CCR_V2`, `CLAUDE_CODE_SKIP_PROMPT_HISTORY`, `API_TIMEOUT_MS`, `DISABLE_TELEMETRY`, and the exclusive keys `CLAUDE_CODE_DISABLE_ARTIFACT` / `CLAUDE_CODE_MAX_CONTEXT_TOKENS`.

**Provider-exclusive env keys** `CLAUDE_EXCLUSIVE_ENV` (`floor.rs:88-113`):
```rust
pub const CLAUDE_EXCLUSIVE_ENV: &[&str] = &[
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",   // AtlasCloud/Soshow reject experimental beta headers
    "CLAUDE_CODE_DISABLE_ARTIFACT",             // DeepSeek strict tool-schema validation → 400
    "ENABLE_TOOL_SEARCH",                       // off by default on third-party endpoints
    "CLAUDE_CODE_DISABLE_THINKING",
    "DISABLE_INTERLEAVED_THINKING",
    "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT",
    "CLAUDE_CODE_EXTRA_BODY",
    "CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING",
    "CLAUDE_CODE_AUTO_MODE_SERVER",             // server-side classifier only on official endpoint
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS",           // window class
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
    "CLAUDE_CODE_DISABLE_1M_CONTEXT",
    "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
];
```
Invariant test (`floor.rs:261-268`): no exclusive key may also be a floor key.

## 2.2 Codex

`CODEX_FLOOR_TOP` (`floor.rs:120-135`):
```rust
pub const CODEX_FLOOR_TOP: &[&str] = &[
    "model_provider",              // reroutes the built-in openai route
    "openai_base_url",
    "model",
    "review_model",
    "model_reasoning_effort",
    "plan_mode_reasoning_effort",
    "disable_response_storage",
    "model_catalog_json",
    "experimental_bearer_token",   // fallback spelling that puts the key at top level
    "base_url",                    // legacy shape when model_provider was absent
    "wire_api",
];
```
Doc `:119`: *"另有 `[model_providers.custom]` 整表"* — the whole `model_providers.custom` table is owned too (`CODEX_PROVIDER_TABLE = ["model_providers","custom"]`, `floor.rs:146`).

`CODEX_FLOOR_NESTED` (`floor.rs:138-143`) — *"嵌在用户自己的表里的模型名：只清这几个键，表里的其他键不动"*:
```rust
pub const CODEX_FLOOR_NESTED: &[&[&str]] = &[
    &["agents", "default_subagent_model"],
    &["agents", "default_subagent_reasoning_effort"],
    &["memories", "extract_model"],
    &["memories", "consolidation_model"],
];
```

`CODEX_EXCLUSIVE_TOP` (`floor.rs:153-159`):
```rust
pub const CODEX_EXCLUSIVE_TOP: &[&str] = &[
    "web_search",
    "model_context_window",
    "model_auto_compact_token_limit",
    "model_supports_reasoning_summaries",
    "model_verbosity",
];
```
Doc `:149-152`: *"**`web_search` 的值不来自行文本，而由 `codex_native_gateway_rejects_web_search` 按供应商判定（需要时为 `"disabled"`）。其余几个会绕过 CC Switch 生成的模型目录，覆盖按模型设好的能力。**"*

## 2.3 Gemini

`gemini_floor_env(key)` (`floor.rs:166-181`):
```rust
pub fn gemini_floor_env(key: &str) -> bool {
    key.starts_with("GOOGLE_")
        || matches!(key,
            "GEMINI_API_KEY"
              | "GEMINI_MODEL"
              | "GEMINI_API_KEY_AUTH_MECHANISM"   // key in x-goog-api-key header vs Authorization: Bearer
              | "GEMINI_CLI_CUSTOM_HEADERS"
              | "GEMINI_DEFAULT_AUTH_TYPE"
              | "GEMINI_CLI_USE_COMPUTE_ADC"
              | "CODE_ASSIST_ENDPOINT"            // Google login endpoint
              | "CODE_ASSIST_API_VERSION"
        )
}
```
Doc `:163-165`: `GEMINI_*` must **not** be prefix-matched — `GEMINI_CLI_HOME`, `GEMINI_SANDBOX`, `GEMINI_SYSTEM_MD`, telemetry switches are provider-agnostic. `GOOGLE_*` *is* entirely connection/auth (Gemini CLI 0.61.0).

`GEMINI_FLOOR_SETTINGS` (`floor.rs:184-185`):
```rust
pub const GEMINI_FLOOR_SETTINGS: &[&[&str]] =
    &[&["security", "auth", "selectedType"], &["model", "name"]];
```
(Used by `services/provider/gemini_editor.rs:35` for edit-conflict masking; the projection uses the same two paths via `selected_type_path()` / `model_name_path()`.)

Gemini has **no exclusive keys** (`live/project/gemini.rs:8-9`).

## 2.4 Claude Desktop

`DESKTOP_PROFILE_FLOOR` (`floor.rs:188-194`):
```rust
pub const DESKTOP_PROFILE_FLOOR: &[&str] = &[
    "inferenceProvider",
    "inferenceGatewayBaseUrl",
    "inferenceGatewayApiKey",
    "inferenceGatewayAuthScheme",
    "inferenceModels",
];
```
`DESKTOP_PROFILE_SEED` (`floor.rs:202-203`) — *"缺失时写入，存在时不动，用户可以自己收紧出站白名单、打开部署模式选择器"*:
```rust
pub const DESKTOP_PROFILE_SEED: &[&str] =
    &["disableDeploymentModeChooser", "coworkEgressAllowedHosts"];
```

## 2.5 Grok Build / OpenCode / OpenClaw / Hermes / Pi / Mcode

**No entries in `floor.rs`.** Grok has no key-level floor (it swaps whole `[model."…"]` tables); the additive apps have no floor at all.

---

# PART 3 — Per app

---

## A. Claude Code (`claude`)

### A.1 Target files
| Path | Format | Private | Evidence |
|---|---|---|---|
| `get_claude_settings_path()` = `<claude config dir>/settings.json`, legacy fallback `claude.json` | JSON (strict `serde_json`) | **0600** | `config.rs:91-97` (`get_claude_config_dir()` = `settings::get_claude_override_dir()` or `~/.claude`), `config.rs:297-310`; `services/provider/claude_direct.rs:22-25` |

```rust
/// `settings.json`（旧安装可能是 `claude.json`）。里面有 Key，按 0600 写。
pub(crate) fn settings_file() -> LiveFile { LiveFile::private(get_claude_settings_path()) }
```
Note `config.rs:303-309`: if `settings.json` doesn't exist but legacy `claude.json` does, the legacy path is used; new files are always `settings.json`.
MCP lives in a *different* file (`~/.claude.json`) and is reprojected idempotently after the switch (`mod.rs:6725-6728`) — never part of this write.

### A.2 Floor cleared on switch
`live/project/claude.rs::direct_patch` (`:89-114`):
```rust
JsonPatch {
    clear: vec![
        ClearScope { parent: KeyPath::root(),        is_floor: floor::claude_floor_top },
        ClearScope { parent: env.clone() /* ["env"] */, is_floor: floor::claude_floor_env },
    ],
    set: target.set_entries(),
    remove_if: outgoing.chain(residue).collect(),
    ..JsonPatch::default()
}
```
- **top level**: every key in `CLAUDE_FLOOR_TOP` (unless the target also sets it — `set` targets are excluded from `clear`);
- **`env`**: every key satisfying `claude_floor_env` (the three prefixes + 7 selectors + 8 keys + `CLAUDE_CODE_SKIP_*_AUTH`);
- `env` itself is *never* removed, only its members.
- `remove`/`remove_if` entries whose path is in `set` are skipped (`json.rs:58-60`, `json.rs:87-89`).

`ClaudeProjection::of(settings)` (`project/claude.rs:34-66`) buckets the row into `top`, `env`, `exclusive`:
```rust
for (key, value) in root            { if floor::claude_floor_top(key) { projection.top.insert(...) } }
for (key, value) in env             {
    if   floor::claude_floor_env(key)    { projection.env.insert(...) }
    else if floor::claude_exclusive_env(key) { projection.exclusive.insert(...) } }
```
Legacy Bedrock conversion (`:53-64`): if `env.CLAUDE_CODE_USE_BEDROCK` is truthy (`is_truthy`: bool / nonzero number / `"1"|"true"|"yes"|"on"` case-insensitive trimmed, `:422-432`), the top-level `apiKey` is `shift_remove`d from `top` and moved to `env["AWS_BEARER_TOKEN_BEDROCK"]` via `entry().or_insert()` (an existing env value wins). `const BEDROCK_BEARER_ENV: &str = "AWS_BEARER_TOKEN_BEDROCK";` (`:16`).

### A.3 Provider-exclusive keys (value-guarded removal)
In `direct_patch`, `outgoing` = **`prev.exclusive`** mapped to `(env.<key>, vec![prev_value])`, fed to `remove_if`. The guard in `json.rs:87-98`:
```rust
if targets.contains(key_path) { continue; }
…
if map.get(key).is_some_and(|current| values.contains(current)) { map.shift_remove(key); }
```
So: **delete only if the live value is still exactly the value the outgoing provider put there.** If the user edited it (`project/claude.rs:550-569` — `CLAUDE_CODE_DISABLE_ARTIFACT` changed `"1"` → `"0"` survives), it's kept.
`set` always wins over `remove_if` (residue never removes a key the target itself writes — `project/claude.rs:602-634`).

Residue removal is appended unconditionally (not gated on `prev`): all 7 (key,value) pairs from `CLAUDE_RESIDUE_ENV`, expanded to string+number forms.

### A.4 Order of operations
`claude_direct.rs`:
1. `write(db, prev, target, pointer)` (`:48-69`) → `ClaudeProjection::of(prev.settings_config)`, `direct_patch(prev, target)`.
2. `run(db, op /* SWITCH if pointer.is_some() else APPLY */, Some(&patch), PendingTarget::pointer(...))` (`:73-89`):
   - `AppWrite::begin(db, "claude")` → lock + `recover_before_write`;
   - one `FileChange { file: settings_file(), patch }`;
   - `write.run(op, &changes, target)` → `operation::run`.
3. Pointer + file committed in the same operation.

Switch entry `switch_claude_direct` (`services/provider/mod.rs:6704-6731`): reads `Purpose::Direct` current id → `prev`; `claude_direct::switch_to(db, prev, provider)`; then `McpService::sync_enabled_for_app` (warn-only).

`reapply(db, prev, target)` = same but `op = APPLY`, `PendingTarget::default()` (no pointer move) — used by `write_live_for_state` (`live.rs:392-397`) and `sync_live_for_provider_respecting_mode` (`live.rs:782-784`, passing `prev.or(Some(provider))`).

Editor path (`claude_editor.rs:114`, `:387`) also uses `claude_direct::settings_file()` and `project_onto` for preview.

### A.5 Quirks
- **No backfill, no common-config merge, no MCP restore** (`claude_direct.rs:1-5`).
- `store_into_row` (`project/claude.rs:135-175`) — round-trip back to the DB row clears **top + env-floor + env-exclusive** and sets the projection; if the row's `env` isn't an object it's replaced wholesale. Legacy Bedrock rows keep the key at top level `apiKey` (`legacy_bedrock_shape`, `:179-196`).
- `project_onto` (`:118-127`) — in-memory preview used by the editor view (`claude_editor.rs:113-124`).
- Proxy contract: `PROXY_TOKEN_PLACEHOLDER: &str = "PROXY_MANAGED"` (`:199`, doc: old versions recognize takeover only by this literal — **must not change**). Aliases `claude-haiku-4-5`, `claude-sonnet-5`, `claude-opus-5`, `claude-fable-5` (`:202-205`); `ONE_M_MARKER_FOR_CLIENT = "[1M]"` (`:207`).
- `ProxyAuth::{FollowRow, Managed{auth_token}}` (`:210-222`) — `FollowRow` writes the placeholder into whichever of `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` the route row has (falls back to `ANTHROPIC_AUTH_TOKEN` if neither); `Managed` writes exactly one key to avoid the "Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set" warning (#4919).
- `proxy_projection` sets `top = Map::new()` — all top-level floor keys are cleared in proxy mode (`:283-288`).
- Exclusive ownership in the editor comes from the mode state: `claude_editor.rs::live_exclusive_owner` returns `contract.exclusive` when attached, otherwise the direct pointer's projection.

---

## B. Codex (`codex`)

### B.1 Target files
| Path | Format | Private | Evidence |
|---|---|---|---|
| `get_codex_config_path()` = `<codex dir>/config.toml` | **TOML** (`toml_edit`) | **0600** | `codex_config.rs:832-834`, dir at `codex_config.rs:270-276` (`settings::get_codex_override_dir()` or `~/.codex`); `codex_direct.rs:1095-1098` |
| `get_codex_auth_path()` = `<codex dir>/auth.json` | JSON (whole-file `Guarded`) | **0600** | `codex_config.rs:279-281`; `codex_direct.rs:1089-1094` |
| `get_codex_model_catalog_path()` = `<codex dir>/cc-switch-model-catalog.json` | JSON (whole-file) | **shared (not 0600)** | `codex_config.rs:836-838`, filename const `CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME = "cc-switch-model-catalog.json"` (`codex_config.rs:25`); `codex_direct.rs:1099-1104` uses `LiveFile::shared` |
| `get_codex_managed_oauth_live_auth_marker_path()` = `<app config dir>/codex_managed_oauth_live_auth.json` | JSON (whole-file `Guarded`) | **0600** | `codex_config.rs:159`, `codex_config.rs:283-285`; `codex_direct.rs:1105-1110` |
| `<device>/.cc-switch/codex-login-stash.json` (`STASH_FILENAME`, `codex_login.rs:28`) | JSON pretty (whole-file `Guarded`) | **0600** | `codex_direct.rs:1111-1116` = `LiveFile::private(store.file(STASH_FILENAME))` |

FileChange order in `codex_direct.rs:1087-1116` — **`auth.json` first**:
```rust
// auth.json 放第一个：Codex CLI 恰好在这时刷新了登录，就在发布任何文件之前停下。
```
then `config.toml`, then model catalog, then managed marker, then stash.

### B.2 Floor cleared on switch
`CodexConfigPatch::apply_to` (`live/project/codex.rs:593-692`), explicit **5 steps**:

**Step 1 — clear top-level floor** (`:611-625`):
```rust
let doomed: Vec<String> = root.iter().map(|(k,_)| k.to_string()).filter(|key| {
    floor::CODEX_FLOOR_TOP.contains(&key.as_str())
        && !target_top.contains(&key.as_str())     // target_top = self.top ++ self.exclusive
        && !route_keys.contains(&key.as_str())     // "model_provider" / "openai_base_url" when step 4 writes them
}).collect();
for key in doomed {
    if key == MODEL_CATALOG_JSON && self.catalog { continue; }   // pointer to our own catalog is kept for step 5
    root.remove(&key);
}
```

**Step 2 — nested floor** (`:628-646`): for each `CODEX_FLOOR_NESTED` path, if the target doesn't set that exact path, walk the parents as tables and `table.remove(last)`. Only those four keys; the rest of `[agents]`/`[memories]` untouched.

**Step 3 — outgoing exclusives, value-guarded** (`:650-662`):
```rust
for (key, value) in &self.outgoing {
    if target_top.contains(&key.as_str()) || floor::CODEX_FLOOR_TOP.contains(&key.as_str()) { continue; }
    let matches = root.get(key).and_then(Item::as_value)
        .is_some_and(|current| same_value(current, value));
    if matches { root.remove(key); }
}
```
`same_value` (`patch/toml.rs:158-160`) compares `value_text` — decor/comments ignored, spelling must match.

**Step 4 — route/table** → `self.write_route(path, doc)` (`:665`, impl `:694-817`).

**Step 5 — target values in place** (`:669-689`):
```rust
for (key, value) in self.top.iter().chain(&self.exclusive) { put_value(root, key, value); }
for (segments, value) in &self.nested { /* create parent tables as needed, then put_value */ }
let row_pointer = self.top.iter().any(|(key,_)| key == MODEL_CATALOG_JSON);
if self.catalog && !row_pointer { put_value(root, MODEL_CATALOG_JSON, &TomlValue::from(CATALOG_FILENAME)); }
check_effective_route(doc, selector)?;
```
`put_value` (`:539-551`) keeps the old decor (indent + trailing comment) on in-place replacement, appends otherwise.

`outgoing` comes from `codex_direct::outgoing_exclusive(owner)` (`codex_direct.rs:391-413`):
- `Owner::Provider(p)` → `exclusive_of(p, project(p))`; if projection fails → log warn and `Vec::new()` (nothing cleaned).
- `Owner::Contract { contract, .. }` → `contract.exclusive` parsed as TOML literals.
- `Owner::None` → `Vec::new()`.

`exclusive_of(provider, projection)` (`codex_direct.rs:373-388`) — the `web_search` override:
```rust
let mut exclusive = projection.exclusive.clone();
let profile = crate::proxy::providers::resolve_codex_catalog_tool_profile(provider);
if codex_disables_web_search(&provider.settings_config, &projection.catalog_input_text(), profile) {
    exclusive.retain(|(key, _)| key != "web_search");
    exclusive.push(("web_search".to_string(), TomlValue::from(WEB_SEARCH_DISABLED)));
}
exclusive
```
with `pub const WEB_SEARCH_DISABLED: &str = "disabled";` (`project/codex.rs:32`) / `CODEX_WEB_SEARCH_DISABLED: &str = "disabled"` (`codex_config.rs:38`, doc: *"ownership sentinel: we only ever remove a `web_search` key whose value equals this string, never a user's own setting"*).

**Stack mode drops two window keys** (`codex_direct.rs:711-712`, applied at `:626`):
```rust
const STACK_SUNK_WINDOW_KEYS: &[&str] = &["model_context_window", "model_auto_compact_token_limit"];
// 窗口类全局键会覆盖目录里的每一行，改由各家写进自己的行。
```

### B.3 `web_search` decision function
`codex_config.rs:2251-2264`:
```rust
pub(crate) fn codex_disables_web_search(settings: &Value, config_text: &str, profile: CodexCatalogToolProfile) -> bool {
    match profile {
        CodexCatalogToolProfile::Anthropic | CodexCatalogToolProfile::Copilot => true,
        CodexCatalogToolProfile::NativeResponses =>
            !codex_catalog_model_specs(settings).is_empty()
                && codex_native_gateway_rejects_web_search(config_text),
        CodexCatalogToolProfile::ProxyChat => false,
    }
}
```
`codex_native_gateway_rejects_web_search` (`codex_config.rs:140-147`): host blacklist match **OR** top-level `model` brand-prefix match.

```rust
const CODEX_WEB_SEARCH_REJECT_HOSTS: &[&str] = &[          // codex_config.rs:58-84
    "xiaomimimo.com", "longcat.chat",
    "minimax.io", "minimax.cn", "minimaxi.com",
    "stepfun.com", "stepfun.ai",
    "qianfan.baidubce.com", "xf-yun.com",
    "bigmodel.cn", "z.ai",
];
const CODEX_WEB_SEARCH_REJECT_MODEL_PREFIXES: &[&str] =
    &["mimo", "longcat", "minimax", "qwen3-coder", "glm"];  // codex_config.rs:90-91
```
- host match is **label-exact** (`codex_url_host_matches_any`, `codex_config.rs:116-125`: `host == candidate || host.ends_with("." + candidate)`) — so `xyz.ai` never matches `z.ai`;
- model match strips an aggregator `vendor/` prefix (`codex_model_rejects_web_search`, `:151-157`: lowercase, take segment after last `/`, then `starts_with(prefix)`).
- doc `:40-57` stresses it is a **blacklist** (default-on): unknown providers keep Codex's default.

Profile resolution `resolve_codex_catalog_tool_profile` (`proxy/providers/codex.rs:399-460`): official → `NativeResponses`; `is_xai_oauth` → `NativeResponses`; `is_github_copilot` → `Copilot`; `codex_provider_uses_anthropic` → `Anthropic`; base_url on a listed native-Responses vendor → `NativeResponses`; else `CodexCatalogToolProfile::from_api_format(apiFormat)` (`Some("anthropic")→Anthropic`, `Some("openai_responses")→NativeResponses`, `_→ProxyChat`).

### B.4 Projection input & route normalization (`project/codex.rs`)

Constants (`:22-49`):
```rust
pub const ROUTE_ID: &str = "custom";
pub const OFFICIAL_PROXY_ROUTE_ID: &str = "cc-switch-official";
const OPENAI_BASE_URL: &str = "openai_base_url";
pub const CATALOG_FILENAME: &str = "cc-switch-model-catalog.json";
pub const WEB_SEARCH_DISABLED: &str = "disabled";
pub const MODEL_CATALOG_JSON: &str = "model_catalog_json";
const BUILT_IN_IDS: &[&str] = &["amazon-bedrock","amazon-bedrock-runtime","openai","ollama","lmstudio"];
const RESERVED_TABLE_IDS: &[&str] = &["openai","ollama","lmstudio"];
const DEFAULT_PROVIDER_ID: &str = "openai";
const BEDROCK_IDS: &[&str] = &["amazon-bedrock","amazon-bedrock-runtime"];
const LEGACY_REROUTE_ID: &str = "cc-switch";
const ROW_TOP_FIELDS: &[&str] = &["model","review_model","model_reasoning_effort",
                                  "plan_mode_reasoning_effort","disable_response_storage"];
```

`CodexProjection::of(RowInput { settings, official, proxy_injected_oauth })` (`:131-191`):
- requires `settings` to be an object and to contain `auth`, else `AppError::Config`;
- `config` TOML must parse (`provider.codex.config.invalid`);
- `top` = `ROW_TOP_FIELDS` present in the row doc (+ `model_catalog_json` if `foreign_catalog(&doc)` — i.e. a pointer **not** named `cc-switch-model-catalog.json`);
- `nested` = `CODEX_FLOOR_NESTED` values present in the row;
- `exclusive` = `CODEX_EXCLUSIVE_TOP` values present in the row;
- route = `Route::Official` if `input.official`, else `third_party_route(&doc, input)`.

`third_party_route` (`:282-327`) — normalization order:
1. empty doc but a key present → `provider.codex.config.missing` ("Codex 第三方供应商缺少 config.toml 配置，无法写入 bearer token");
2. selector not built-in → its `[model_providers.<id>]` table, else `provider.codex.config.no_custom_provider`;
3. selector ∈ `RESERVED_TABLE_IDS` with a table → **rewrite into `custom`**, force `wire_api = "responses"`, name `"Custom"` (Codex ≥0.148 rejects reserved-id tables wholesale);
4. no selector or selector == `"openai"` + top-level `openai_base_url` → synthesize table `{name="Custom", base_url=…, wire_api="responses"}`;
5. no selector at all and no `openai_base_url` → `Route::Default` (intentional pass-through);
6. built-in selector → `built_in_route(id, …)` (Bedrock may carry an override table).

`row_key` (`:331-342`): `auth.OPENAI_API_KEY` → table's `experimental_bearer_token` → top-level `experimental_bearer_token`.

`RouteAuth` (`:66-75`): `EnvKey | Bearer | Headers | None`.
`declared_auth` (`:265-280`): `env_key` → `EnvKey`; `auth` or `aws` → `Headers`; unless `requires_openai_auth` is true, an `Authorization` header in `http_headers`/`env_http_headers` → `Headers`; else `None`.

`custom_route` (`:359-398`):
- inject `name` if missing (fallback = the row's provider id, else `"Custom"`);
- if no declared auth and a key exists → `table.insert("experimental_bearer_token", key)`, `RouteAuth::Bearer`;
- no declared auth and no key → if `(requires_openai_auth || rerouted) && !proxy_injected_oauth` → **`keyless_fallback_error()`** (`provider.codex.config.official_auth_fallback`); else `Headers` if `query_params`/`http_headers`/`env_http_headers` declare an Authorization header, else `None`;
- if `auth ∈ {Headers, None}` → `table.remove("requires_openai_auth")`.

`built_in_route` (`:400-421`): id `"openai"` → error either way (with a key: `no_token_slot_error()` "Codex 不识别顶层 experimental_bearer_token"; without: `keyless_fallback_error()`). Bedrock ids may keep their table.

`requires_openai_auth(auth, login_on_disk)` (`:85-87`):
```rust
pub fn requires_openai_auth(auth: RouteAuth, login_on_disk: bool) -> bool {
    matches!(auth, RouteAuth::EnvKey | RouteAuth::Bearer) && login_on_disk
}
```
Doc `:77-84` explains the semantics on Codex 0.149: it does not decide *which* credential is used, but decides the login UI (true + no login → stuck on the login page; false + a ChatGPT login present → Codex treats you as logged out). Headers/None are **always** `false` so requests don't fall back to sending `auth.json`'s official login to a third-party address. Official mirror forms are always `true`.

### B.5 `write_route` details (`project/codex.rs:694-817`)
```rust
match self.route.selector() { Some(id) => put_value(root,"model_provider",id), None => root.remove("model_provider") }
if let Some(base_url) = self.route.openai_base_url() { put_value(root, OPENAI_BASE_URL, base_url); }
let referenced = profile_selectors(root);       // [profiles.*].model_provider ids
```
- If `model_providers` absent → create it only when `owned_table()` yields one (`Custom` → `custom`; `OfficialMirror` → mirror; `OfficialProxy{unified:true}` → mirror; `BuiltIn{table:Some}` → that id) (`:707-718`, `:820-834`).
- **Reserved-id tables** (`:725-738`): for each of `RESERVED_TABLE_IDS`, remove the table; if it's provably ours (`is_retired`) or `holds_placeholder` → drop it; otherwise **rename** to the first free `cc-switch`, `cc-switch-2`, `cc-switch-3`, … (`first_free_id`, `:853-861`).
- **Doomed tables** (`:742-755`): ids ≠ `custom`, not referenced by any profile, and (`id == "cc-switch-official"` OR `holds_placeholder(item)` OR `self.is_retired(id, item)`).
  `holds_placeholder` (`:846-851`) = `experimental_bearer_token == "PROXY_MANAGED"`.
  `is_retired` (`:836-843`) = id **and** `base_url` both match a `KnownTable` from `row_facts`.
- Per-`RouteWrite` behavior (`:757-811`):
  - `Official { dormant_base_url }` → if `custom` exists, rewrite it as `proxy_route_table(custom, dormant_base_url, requires_openai_auth=false)` (dormant, placeholder key) so third-party sessions keep resumable;
  - `Default | BuiltIn{table:None}` → leave `custom` as-is but `table.remove("experimental_bearer_token")` so no real key remains;
  - `BuiltIn{table:Some}` → `put_table(providers, id, …)`;
  - `OfficialMirror` → `put_table(providers, custom, official_mirror_table(None, true))`;
  - `Custom(table)` → `put_table(providers, custom, table)`;
  - `OfficialProxy{unified:false}` → dormant `custom` pointing at the proxy (placeholder key);
  - `OfficialProxy{unified:true}` → `official_mirror_table(Some(base_url), false)`.
- If `providers` ends up empty → `root.remove("model_providers")` (`:813-815`).
- `put_table` (`:865-892`) preserves inline-vs-standard form and the old table's decor + `position`.

`official_mirror_table` (`:480-490`): `name="OpenAI"`, `requires_openai_auth=true`, `supports_websockets=<bool>`, `wire_api="responses"`, optional `base_url` (trailing `/` trimmed).
`proxy_route_table(name, base_url, requires_openai_auth)` (`:493-506`): `name`, `base_url`, `wire_api="responses"`, `experimental_bearer_token="PROXY_MANAGED"`, optional `requires_openai_auth=true`.

### B.6 Profile-override conflict detection
`check_effective_route(doc, selector)` (`project/codex.rs:911-943`) — runs at the **end** of `CodexConfigPatch::apply_to`:
```rust
let Some(name) = non_empty_str(doc.get("profile")) else { return Ok(()); };
let Some(profile) = doc["profiles"].get(&name) … else { return Ok(()); };
let overridden = ["model_provider", "openai_base_url", "experimental_bearer_token"].into_iter()
    .find(|key| match (*key, non_empty_str(profile.get(key))) {
        (_, None) => false,
        // top-level absent model_provider means Codex's built-in `openai`
        ("model_provider", Some(id)) => id != selector.unwrap_or(DEFAULT_PROVIDER_ID),
        _ => true,
    });
match overridden { Some(key) => Err(LiveWriteError::Route{ profile: name, key }), None => Ok(()) }
```
Error message: `"Codex 当前生效的 profile \"{profile}\"（[profiles.{profile}]）设置了 {key}，切换后请求仍会按它发出… 本次没有写入任何文件"` (`patch/mod.rs:194-202`).

`profile_selectors(root)` (`:895-907`) collects `[profiles.*].model_provider` — tables referenced this way are never deleted as "retired".

### B.7 Model catalog pointer handling
- `foreign_catalog(doc)` (`:567-575`) = top-level `model_catalog_json` whose file name ≠ `cc-switch-model-catalog.json`. Only such pointers are taken into `projection.top` (and thus become floor-cleared on switch).
- `is_cc_switch_catalog(value)` (`:553-555`) compares `Path::file_name()` to `CATALOG_FILENAME`.
- `live_catalog_is_ours(config_text)` (`:578-584`).
- `row_catalog_pointer(top)` (`:588-590`) — *"它和别的关键字段一样只属于这一家：切到别家时第 1 步清掉"*.
- `without_row_catalog(config_text)` (`:559-564`) — strips the row's own pointer (used for Stack route display).
- Step-1 special case (`:621-624`): if `self.catalog` (we generated a catalog) the `model_catalog_json` key is *skipped* from deletion; step 5 then sets it to `CATALATALOG_FILENAME` only when the row didn't bring its own pointer (`:686-689`).
- `catalog_input_text()` (`:195-208`) builds the normalized config used by catalog + web_search decisions: `top ++ exclusive` keys, plus `model_provider="custom"` and `[model_providers.custom]` when the route is `Custom`.

### B.8 Order of operations — `codex_direct.rs`

Three phases documented at `codex_direct.rs:9-15`:
1. **`prepare(manager, owner, target)`** (`:173-205`) — *before* the lock (network):
   - target managed account → `get_codex_managed_oauth_live_auth_value` (ensure account exists, get valid token bundle, require `id_token`, build full auth);
   - outgoing managed account (different from target) → `prepare_codex_managed_oauth_live_auth_switch_away` (adopt Codex CLI's rotated refresh token, return disk token for compare-before-write).
2. **`plan(db, owner, target, prepared)`** (`:532-683`) — pure computation, any row problem errors here with nothing written:
   - `row_facts(db)` (`:423-486`) over **all** Codex rows: `retired: Vec<KnownTable{id, base_url}>` (row's own selector table id + base_url, and `{"cc-switch", openai_base_url}` for legacy reroutes), `third_party_keys` (every non-official row's `auth.OPENAI_API_KEY`), `official_logins` (official rows' credential login material, excluding managed accounts — seeds the stash on first creation);
   - `exclusive_of(...)` incl. `web_search`;
   - route/auth decision:
     - `Target::Direct(None)` or projection `None` → `(RouteWrite::Default, None, AuthGoal::KeepNative)`;
     - direct official + `unify_codex_session_history()` → `OfficialMirror`; direct official → `Official { dormant_base_url: configured_proxy_base_url(db) }`;
     - direct custom/built-in/default → matching `RouteWrite`, `stamp = Some(RouteAuth::Bearer|EnvKey|…)` only for `Custom`;
     - proxy official → `OfficialProxy { base_url, unified: unify_codex_session_history() }`; proxy third-party → `Custom(proxy_route_table("custom", base_url, false))`, `stamp = Bearer`, `AuthGoal::KeepNative`;
   - `auth` goal: managed login → `AuthGoal::Managed`; else official → `Official(row_auth)`; else `ThirdParty`;
   - catalog: stack catalog if `stack` non-empty, else `plan_codex_model_catalog(...)`; serialized with `sorted_json_bytes`;
   - `leaving_official` = outgoing official unmanaged row's `auth`;
   - `contract_of(...)` (`:807-870`) builds the `Contract { version, key, exclusive }` digest over `{app:"codex", version, url, top(sorted pairs), nested, exclusive(sorted pairs), selector, table(without requires_openai_auth), catalog digest, managed, login}`.
3. **`run` / `run_with_edits(db, op, planned, prepared, pending, edits)`** (`:931-1122`):
   - `AppWrite::begin(db, "codex")` — lock + finish any prior operation;
   - `prepared.outgoing.ensure_unchanged(account)?` — stop if the CLI refreshed again after adoption;
   - read `auth.json` (unreadable ⇒ log warn, `auth_readable=false`, leave it alone);
   - `live_is_managed(...)`, `load_stash(...)`;
   - `codex_login::plan(AuthInput { live, live_is_managed, third_party_keys, leaving_official, target: auth_target(goal), stash })`;
   - if `planned.native_identity` set: recompute the actual login after the plan and **abort** with `codex.official_models_login_changed` if it differs ("本次没有写入任何文件，请重试");
   - if the stash is unreadable **and** the plan wants to write a login into it → abort with `codex.login_stash_unreadable`;
   - `login` per `cli_auth_credentials_store`: `File → auth_plan.login_on_disk`; `Ephemeral → false`; `Keyring|Auto|Unknown → !(AuthGoal::ThirdParty) || preserve_codex_official_auth_on_switch()`;
   - stamp `requires_openai_auth` onto the custom table only when `stamp ∈ {Bearer, EnvKey}`:
     ```rust
     table.insert("requires_openai_auth", toml_edit::value(requires_openai_auth(kind, login)));
     ```
   - build `Guarded` patches for `auth.json`, the managed marker, and the stash; `WholeFile::Write` for the catalog;
   - `config_steps = [edits?, &config]` inside `TomlSteps` (editor changes first, then key fields);
   - push FileChanges in order auth → config → catalog → marker → stash;
   - `write.run(op, &changes, pending)`;
   - `super::codex_client_catalog::observe(store)` — record what a newly started Codex would read (`codex_client_catalog.rs:239-245`).

### B.9 `auth.json` plan (`services/provider/codex_login.rs`, 489 lines)

`AuthTarget` (`:121-130`): `ThirdParty { preserve }`, `ProxyThirdParty`, `Official { row_auth }`, `Managed { auth }`.
`AuthPlan { auth: Option<Option<Value>>, stash: Option<LoginStash>, login_on_disk: bool }` (`:146-155`) — `None` = don't touch; `Some(None)` = delete; `Some(Some(v))` = write whole file.

`plan(input)` (`:157-219`):
```rust
let residue = live.is_some_and(|auth| !managed && is_residue(auth, input.third_party_keys));
let native  = live.filter(|auth| !managed && !residue && codex_auth_has_login_material(auth));

// leaving an official card with no login on disk invalidates its stash entry
if let Some(row_auth) = input.leaving_official { if native.is_none() && !managed { … stash.take(id) / stash.take(last) … } }

match input.target {
  ThirdParty { preserve } => { if let Some(live)=native.filter(|_| !preserve) { stash.put(live); }
                               (managed || residue || (!preserve && input.live.is_some())).then_some(None) }
  ProxyThirdParty          => managed.then_some(None),          // never touch the native login
  Managed { auth }         => { if let Some(live)=native { stash.put(live); } Some(Some(auth.clone())) }
  Official { row_auth }    => official(row_auth, native, managed||residue, &mut stash),
}
```
`official(...)` (`:223-254`): API-key credential → always `Some(Some(row_auth))` (stash the current login if different); OAuth → swap only when identities differ *and* the wanted identity is in the stash; no login on disk → restore `stash.take(wanted)` else `stash.take(stash.last)`, or `clearable.then_some(None)`.

`is_residue` (`:114-117`): `codex_live_auth_is_stale_third_party_residue(auth)` **AND** its `OPENAI_API_KEY` equals some third-party row's key (so a user's own `codex login --api-key` key is never deleted).

`LoginStash` (`:31-68`): `{ logins: BTreeMap<String,Value>, last: Option<String>, #[serde(skip)] initialized: bool }`. `seeded_from_rows` is used **only the first time** the stash file is created; afterwards the file is authoritative (`stale_row_snapshots_are_only_a_one_time_seed`, `:355-378`).
`identity()` (`:71-87`): id_token user → `tokens.account_id` → `"api-key"` → `"unknown"`.
`official_login_requirement(row_auth)` (`:97-104`) — folded into the proxy contract (`api-key:<sha256>` for API-key cards, else the OAuth identity).

Managed marker path: `codex_config.rs:159` `CODEX_MANAGED_OAUTH_LIVE_AUTH_MARKER_FILENAME = "codex_managed_oauth_live_auth.json"`; written/deleted via `Guarded` at `codex_direct.rs:1054-1067`.

### B.10 Other Codex quirks
- `check_stack_member`, `route_owns_catalog`, `settings_without_row_catalog` (`codex_direct.rs:686-709`) gate Stack aggregation.
- `STACK_SUNK_WINDOW_KEYS` removal when a stack catalog is produced.
- `preflight(db, provider)` (`:1140-1143`) runs `plan` with `Owner::None` + default `Prepared` purely to reject a bad row *before* the pointer moves (`mod.rs:5616`, `:6274`).
- `Owner` enum (`:124-142`): `Provider | Contract { contract, route } | None`.
- `Target` enum (`:109-119`): `Direct(Option<&Provider>)` (`None` = no direct provider → only clear key fields) | `Proxy { route, base_url, stack }`.
- `is_official(provider)` (`:62-65`) = `category == "official"` OR `proxy::providers::is_codex_official_provider`.
- `write_direct(db, manager, op, owner, target, pending)` (`:1125-1137`) = `prepare → plan → run`.
- On switch, if `auth.json` still exists after a preservation-off third-party switch, the switch is **not** failed; a warning `codex_auth_cleanup_failed` is appended (`mod.rs:6755-6766`).

---

## C. Gemini CLI (`gemini`)

### C.1 Target files
| Path | Format | Private | Evidence |
|---|---|---|---|
| `get_gemini_env_path()` = `<gemini dir>/.env` | **`.env`** (line-oriented) | **0600** | `gemini_config.rs:18-20`, dir `gemini_config.rs:9-15` (`settings::get_gemini_override_dir()` or `~/.gemini`); `gemini_direct.rs:28-31` `LiveFile::private` |
| `get_gemini_settings_path()` = `<gemini dir>/settings.json` | JSON | **shared (not 0600)** | `gemini_config.rs:329-331`; `gemini_direct.rs:33-36` `LiveFile::shared` |

### C.2 Floor
`.env` — `DotenvPatch { clear: Some(floor::gemini_floor_env), set: projection.env, … }` (`project/gemini.rs:100-106`):
clears every line whose key satisfies `gemini_floor_env` (the `GOOGLE_*` prefix + the 8 enumerated `GEMINI_*`/`CODE_ASSIST_*` keys), *unless* the target also sets it. Comments, blank lines, unrecognized lines, `export ` prefixes and line order are preserved.

`settings.json` — exactly two key paths (`project/gemini.rs:108-119`):
```rust
match self.selected_type {
    Some(selected) => patch.set.push((selected_type_path(), json!(selected))),
    None            => patch.remove.push(selected_type_path()),   // selected_type is None only when clearing
}
match &self.model_name {
    Some(name) => patch.set.push((model_name_path(), name.clone())),
    None       => patch.remove.push(model_name_path()),
}
// selected_type_path = ["security","auth","selectedType"]   (:131-133)
// model_name_path    = ["model","name"]                     (:135-137)
```
Sibling keys in those objects (e.g. `model.compressionThreshold`, `security.auth.useExternal`) are untouched (`project/gemini.rs:206-217`).

**Gemini has no `exclusive` bucket and no residue entries.**

### C.3 Projection
`GeminiProjection::of(settings, official)` (`project/gemini.rs:44-68`):
- `env` = row `env` entries satisfying `gemini_floor_env`, **keeping only string values**, in row order;
- `selected_type = Some("oauth-personal")` if `official`, else `Some("gemini-api-key")` — *"不读行里的值"* (a backfilled `/auth` choice must not make a third-party card use Google login);
- `model_name` = row `/config/model/name` if not null.

Constants (`:19-26`):
```rust
pub const SELECTED_TYPE_OAUTH: &str = "oauth-personal";
pub const SELECTED_TYPE_API_KEY: &str = "gemini-api-key";
pub const BASE_URL_ENV: &str = "GOOGLE_GEMINI_BASE_URL";
pub const API_KEY_ENV: &str = "GEMINI_API_KEY";
const MODEL_ENV: &str = "GEMINI_MODEL";
```
`GeminiProjection::empty()` (`:71-77`) = clear-only (no direct provider).

Proxy contract (`:84-98`): env = route's `GEMINI_MODEL` (if any) + `GOOGLE_GEMINI_BASE_URL=<proxy>` + `GEMINI_API_KEY=PROXY_MANAGED`; `selected_type = "gemini-api-key"`; `model_name` from route.

### C.4 Order of operations (`gemini_direct.rs`)
- `projection(provider)` (`:45-52`): `validate_gemini_settings` always; if **not** official also `validate_gemini_settings_strict`; validation failure ⇒ **nothing is written**.
  - `validate_gemini_settings` (`gemini_config.rs:264-289`): `env` must be an object; `config` must be object or null.
  - `validate_gemini_settings_strict` (`gemini_config.rs:295-324`): if the env map is empty → OK (OAuth); otherwise at least one of `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI` must exist.
- `switch_to` → `op::SWITCH` + `PendingTarget::pointer(Some(id))`; `reapply` → `op::APPLY` + `PendingTarget::default()`.
- `run_with_edits(db, op, projection, target, edits)` (`:83-114`): `AppWrite::begin` → build `EnvWrite { edits, key_fields: env_patch }` and `SettingsWrite { edits, key_fields: settings_patch }` → push FileChange for `.env` only if `projection.is_some() || edits.touches_env()`, and for `settings.json` only if `projection.is_some() || edits.touches_settings()` → `write.run(op, changes, target)`. Both files + state commit as **one** operation.
- Ordering inside each file (`gemini_editor.rs:271-340`): editor edits first (three-way conflict resolution), **then** key fields. In `SettingsWrite`, floor values present before the edit are captured and restored after the edit patch so a whole-object replacement can't clobber them (`:324-333`).
- Official detection `is_official(provider)` (`gemini_direct.rs:39-41`) = `category == "official"` OR `gemini_auth::is_google_official_gemini(provider)`.

---

## D. Grok Build (`grokbuild`)

### D.1 Target files
| Path | Format | Private | Evidence |
|---|---|---|---|
| `get_grok_config_path()` = `<grok dir>/config.toml` | **TOML** (`toml_edit`) | **0600** | `grok_config.rs:25-32`, dir = `settings::get_grok_override_dir()` or `~/.grok`; `grok_direct.rs:27-30` |

### D.2 What it owns
No key-level floor. It owns:
1. `[models] default` (target's table name; **removed** for official cards);
2. the whole `[model."<name>"]` table of the target — *"整表指表里的所有键（`model`、`base_url`、`api_key` / `env_key`，以及 `reasoning_summary`、`extra_headers` 等）：只换其中几个键会留下上一家的 `env_key`、模型名"* (`project/grok.rs:1-11`);
3. retired tables from the **write record** (not from live `models.default`, because Grok's `/settings` can rewrite the default — `project/grok.rs:8-9`);
4. any table whose `api_key == "PROXY_MANAGED"` (stale proxy contracts), except the target's own.

`GrokProjection::of(settings, official)` (`project/grok.rs:38-73`): official → `{table: None}`; else parse row `config` TOML, `resolve_table_name` (`:118-160`): prefer `models.default` if it names an existing `[model.*]`; else the single table; else error (`provider.grokbuild.model.missing` / `provider.grokbuild.default_model.ambiguous` listing the candidates). Then `crate::grok_config::validate_config_toml(&normalized_text(...))` on `model`/`base_url`/`name`/`api_key`|`env_key`/`api_backend`/`context_window`.

`GrokConfigPatch` (`project/grok.rs:210-218`):
```rust
pub struct GrokConfigPatch {
    pub target: Option<(String, Table)>,
    pub retired: Vec<String>,        // last write record's tables; target's own table never deleted
    pub placeholder: Option<String>, // api_key value marking CC Switch proxy contracts
}
```
`apply_to` (`:229-305`) order:
1. set/remove `[models].default` (in place, decor preserved);
2. delete `doomed` tables under `[model]` — `name != target_name && (retired.contains(name) || api_key == placeholder)`;
3. insert/replace the target's whole table (decor + `position` copied from the old table if it existed);
4. **delete empty `[model]` and `[models]` tables** — *"Grok 靠「没有这两张表」认出官方状态"* (`:294-303`).
`table_mut` creates `model` as an **implicit** table (so only `[model."…"]` is emitted) and returns `Shape { expected: "表" }` otherwise (`:315-337`).

### D.3 Order of operations (`grok_direct.rs`)
- `retired_tables(store, live_owner)` (`:45-74`): if `state::written(store, "grokbuild")` exists → `written.tables`; else infer from the live owner's row (`projection(owner).written_tables()`, falling back to the row's `models.default` string). *"有写入记录就按记录；这台设备上新版还没写过（刚从旧版升级）时，按旧版的写法推断"*.
- `run_with_edits(...)` (`:125-167`):
  1. `AppWrite::begin(db, "grokbuild")` — finish any prior operation first (*"它可能改了写入记录和指针，下面要按最新的记录删表"*);
  2. if `projection.is_some()` → set `target.written = Written { tables: projection.written_tables(), .. }` and build `GrokConfigPatch::direct(projection, retired_tables(...), PROXY_TOKEN_PLACEHOLDER)`;
  3. `steps = [edits?, patch]` in `TomlSteps` — editor edits first, then the model table;
  4. one `FileChange { file: config_file(), patch }` → `app_write.run(op, changes, target)`.
- `switch_to` → `op::SWITCH` + pointer; `reapply` → `op::APPLY`, no pointer (`:78-93`).
- `is_official(provider) = category == "official"` (`:33-35`); official cards write **no** table (Grok falls back to built-in models + its own xAI login).
- Proxy contract (`project/grok.rs:82-101`): clone route table, set `base_url=<proxy>`, `api_key="PROXY_MANAGED"`, `api_backend="responses"` (`PROXY_API_BACKEND`), **keep `env_key`** (Grok prefers table `api_key`, so the placeholder takes precedence). Official cards can't be a proxy route (`provider.grokbuild.proxy.official`).

---

## E. Claude Desktop (`claude-desktop`)

**Uses the engine** (`lock_app`, `operation::run`, `LiveFile`, `JsonPatch`, `floor::DESKTOP_PROFILE_FLOOR`), but has no `live/project/` module — its projection lives in `claude_desktop_config.rs`.

### E.1 Target files (`paths_from_dirs`, `claude_desktop_config.rs:1372-1385`)
```rust
CONFIG_FILE = "claude_desktop_config.json"   // :24
CONFIG_LIBRARY_DIR = "configLibrary"         // :26
profile_path = <threep_dir>/configLibrary/<PROFILE_ID>.json
meta_path    = <threep_dir>/configLibrary/_meta.json
```
`PROFILE_ID = "00000000-0000-4000-8000-000000157210"`, `PROFILE_NAME = "CC Switch"` (`:20-21`).

| File | Format | Private | Evidence |
|---|---|---|---|
| `<normal_dir>/claude_desktop_config.json` | JSON | shared | `:994`, `:1038` |
| `<threep_dir>/claude_desktop_config.json` | JSON | shared | `:998`, `:1042` |
| `<threep_dir>/configLibrary/00000000-0000-4000-8000-000000157210.json` | JSON | **0600** (contains gateway key) | `:1002`, `:1052` |
| `<threep_dir>/configLibrary/_meta.json` | JSON | shared | `:1006`, `:1046` |

Directory resolution: macOS `~/Library/Application Support/{Claude,Claude-3p}` (`:1324-1327`); Windows `%LOCALAPPDATA%/{Claude,Claude-3p}` with a fuzzy `pick_windows_claude_dir` fallback matching `name.starts_with("Claude")` and `contains("-3p")` (`:1337-1369`); Linux `~/.config/{Claude,Claude-3p}` using host `XDG_CONFIG_HOME` (absolute only) or `~/.config`, with Flatpak forcing `home/.config` (`:1292-1321`).

### E.2 Floor / seed
`restore_official_at_paths` (`:1019-1057`) — switching back to official:
```rust
let profile = JsonPatch { clear: vec![ClearScope { parent: KeyPath::root(), is_floor: floor::desktop_profile_floor }], .. };
```
⇒ removes `inferenceProvider`, `inferenceGatewayBaseUrl`, `inferenceGatewayApiKey`, `inferenceGatewayAuthScheme`, `inferenceModels`. The profile **file is kept** (user's own settings survive), only its floor is cleared, and the Key is removed from disk.

Legacy enterprise keys cleaned only on the 3p config file (`:1085-1091`, wrapped in `DropEmptyEnterpriseConfig` `:1094-1111` which then deletes an empty `enterpriseConfig`):
```rust
const LEGACY_ENTERPRISE_GATEWAY_KEYS: &[&str] = &[
    "disableDeploymentModeChooser", "inferenceGatewayApiKey", "inferenceGatewayAuthScheme",
    "inferenceGatewayBaseUrl", "inferenceProvider",
];
```

### E.3 Entry writes (`gateway_profile_patch`, `:1114-1133`)
```rust
let mut patch = JsonPatch { clear: vec![ClearScope { parent: root, is_floor: floor::desktop_profile_floor }], .. };
for (key, value) in profile {
    if floor::DESKTOP_PROFILE_SEED.contains(&key.as_str()) { patch.seed.push((key_path, value)); }
    else                                                    { patch.set.push((key_path, value)); }
}
```
`build_gateway_profile` (`:1198-1218`) produces:
```json
{ "coworkEgressAllowedHosts": ["*"],
  "disableDeploymentModeChooser": true,
  "inferenceGatewayApiKey": <key>,
  "inferenceGatewayAuthScheme": "bearer",
  "inferenceGatewayBaseUrl": <base_url>,
  "inferenceProvider": "gateway",
  "inferenceModels": [ … ]   // only when there are specs
}
```
Because `disableDeploymentModeChooser` and `coworkEgressAllowedHosts` are `SEED` keys, they are written **only if missing** — the user can tighten the egress allowlist or re-enable the deployment-mode chooser and it sticks.

### E.4 Order of operations
`apply_provider_to_paths` (`:951-1011`):
1. official → `restore_official_at_paths` (4 changes; the profile change is only added if the file exists);
2. else `validate_provider(provider)`; build profile from Direct credentials or Proxy gateway (`proxy_gateway_base_url_from_db` + `get_or_create_gateway_token` + `proxy_model_routes`);
3. `deployment_mode_patch("3p")` applied to **both** config files (`set deploymentMode="3p"`), `gateway_profile_patch(profile)`, `MetaPatch{applied:true}`;
4. `write_desktop_files(paths, changes)` (`:1061-1075`) = `lock_app("claude-desktop")` + `operation::run(device, guard, op::APPLY, changes, PendingTarget::default(), |_| Ok(()))` — **no pointer** (no `current_provider` for Desktop), all 4 files in one operation, rollback if any parse fails (test `claude_desktop_apply_rolls_back_when_profile_write_fails`, `:2200`).

`MetaPatch` (`:1137-1196`): applied → upsert `{id, name}` into `entries` (in place if present, else push) and set/insert `appliedId = PROFILE_ID`; unapplied → remove our entry, then if `appliedId == PROFILE_ID` re-point it to the first remaining entry's id, else `shift_remove("appliedId")`. Non-array `entries` → `Shape { expected: "数组" }`.

`restore_official_at_paths` sets `deploymentMode = "1p"` on both files.

---

# PART 4 — Additive apps (no `live/` engine, no floor)

All five are `is_additive_mode()`; `sync_all_providers_to_live` (`live.rs:707-734`) writes **every** provider whose `meta.live_config_managed != Some(false)`, and a provider that was DB-only gets flipped to `live_config_managed=true` on successful switch, with rollback on DB failure (`mod.rs:6654-6691`).

## 4.1 OpenCode (`opencode`)
- **Path**: `~/.config/opencode/` (or `settings::get_opencode_override_dir()`), file `opencode.jsonc` if it exists else `opencode.json`, default `opencode.json` (`opencode_config.rs:49-71`).
- **Format**: **JSONC** — format-preserving via `crate::jsonc_document::JsoncDocument` (json5 tokenizer round-trip; `jsonc_document.rs:13-36`).
- **Write**: `atomic_write` (**not** private, `opencode_config.rs:1`, `:150`) under a module `Mutex` (`opencode_config_lock`, `:11-14`).
- **Conflict**: `OpenCodeDocument::save` (`:143-156`) re-reads and compares to `previous_contents` → `"OpenCode config changed on disk. Please reload and try again"`.
- **Owner key**: V1 → `provider.<id>`; V2 → `providers.<id>` (`set_provider_with_format`, `:518-570`); `remove_provider` removes both when the legacy one was validly shadowed (`:571-590`).
- Validation gates: V2 requires `validate_native_provider`; a new id without `npm` + at least one `models` entry is rejected at the write boundary (`live.rs:584-602`); V1 fallback writes raw only if the fragment has `npm` or `options` (`live.rs:617-643`).
- Mutual exclusion: OMO ↔ OMO Slim — activating one deletes the other's config file (`mod.rs:6600-6614`).

## 4.2 OpenClaw (`openclaw`)
- **Path**: `~/.openclaw/openclaw.json` (or `get_openclaw_override_dir()`) (`openclaw_config.rs:35-48`).
- **Format**: JSON5/JSONC, round-tripped through its own json5 text document (`set_root_section` at `:280-331` preserves whitespace/separator).
- **Write**: `atomic_write` (`:361`), under `openclaw_write_lock()` (`:59-…`). Backup before every real change: `get_app_config_dir()/backups/openclaw/openclaw_<YYYYmmdd_HHMMSS>[_N].json5`, retention-pruned (`:376-404`).
- **Conflict**: original-source compare → `"OpenCode config changed on disk…"` analog (`:327-334`).
- **Owner key**: `models.providers.<id>`; created with default `{"models":{"mode":"merge","providers":{}}}` (`set_provider`, `:659-684`); typed variant `set_typed_provider` (`:732-741`); `remove_provider` (`:683-…`).
- Also writes `agents.defaults.model` (`set_default_model`, `:…`).

## 4.3 Hermes (`hermes`)
- **Path**: `~/.hermes/config.yaml` (`hermes_config.rs:101-103`); dir = `get_hermes_override_dir()` → `$HERMES_HOME` → platform default (Windows: `%LOCALAPPDATA%\hermes`, else `~/.hermes`) (`:53-80`).
- **Format**: **YAML**; section-level replacement (`find_yaml_section_range` / `serialize_yaml_section` / `replace_yaml_section`, `:267-335`) so only one top-level section is rewritten; duplicate YAML keys deduped before parse (`:159-162`, bug #3633).
- **Write**: `atomic_write` under `hermes_write_lock()` (`:105-108`); backup `get_app_config_dir()/backups/hermes/hermes_<ts>[_N].yaml` (`:364-381`).
- **Owner key**: top-level sequence `custom_providers[]` (`set_provider`, `:792-…`) — the entry gets `name` and `model` (first model id) injected; `sanitize_hermes_provider_keys` + `normalize_provider_models_for_write` run first; `ensure_provider_writable(&config, name, "edit")` guards.
- **Switch behavior**: additive — `apply_switch_defaults(provider_id, settings_config)` (`:927-947`) only rewrites the top-level `model:` section to `{ default: <first model id or keep>, provider: provider_id }`.

## 4.4 Pi (`pi`)
- **Path**: `~/.pi/agent/models.json` (also `settings.json`, `auth.json` in the same dir); dir from `settings::get_pi_override_dir()` → `$PI_CODING_AGENT_DIR` → `~/.pi/agent`, must be absolute (`pi_config/mod.rs:34-74`). `get_pi_models_path()` (`:75-77`), `get_pi_settings_path()` (`:79-81`).
- **Format**: **JSON** (pretty + trailing `\n`).
- **Write**: `atomic_write_private` → **0600** (`pi_config/mod.rs:395-405`), parent dir also made private.
- **Conflict**: revision-based — `ensure_models_revision(path, expected)` compares SHA-256 of the file before write; mismatch → `AppError::Conflict("Pi models.json changed outside CC Switch: …")` (`:411-430`).
- **Owner key**: `providers.<id>` (`providers()` at `:380-390`).
- `settings.json` `defaultProvider` / `defaultModel` and `auth.json` are **never** touched by provider membership (test `provider_membership_never_changes_pi_auth_or_defaults`, `pi.rs:424-466`).
- `write_live_snapshot` for Pi always errors: `"Pi providers use the Pi provider service"` (`live.rs:694-698`); `sync_current_to_live` skips `Pi` and `Mcode` (`live.rs:828-831`).

## 4.5 MCode (`mcode`)
- **Path**: `<data_dir>/config.yaml` where `data_dir()` = `$MINIMAX_DATA_DIR` or `$MAVIS_DATA_DIR` or `~/.minimax` (`mcode_config.rs:13-30`, `config_path()` at `:59-61`).
- **Format**: **YAML** (whole-document re-serialize).
- **Write**: `atomic_write_private` → **0600** (`mcode_config.rs:2`, `:269`).
- **Owner key**: top-level mapping `custom_provider.<id>` (`write_entry`, `:225-270`); entries with `kind != "custom"` are MCode-owned and can't be overwritten/removed (`:248-256`); id charset restricted to `[A-Za-z0-9_-]` (`:119-130`); `api` must be one of `anthropic-messages | openai-completions | openai-responses` (default `anthropic-messages`).
- `write_and_commit(path, write, commit)` (`:33-59`) — native write + DB commit with rollback of the file on DB failure.

---

# PART 5 — Quick reference: files × format × private

| App | File | Format | 0600 | Engine? |
|---|---|---|---|---|
| claude | `~/.claude/settings.json` (legacy `claude.json`) | JSON | **yes** | yes (`JsonPatch`) |
| codex | `~/.codex/config.toml` | TOML | **yes** | yes (`TomlSteps`) |
| codex | `~/.codex/auth.json` | JSON whole | **yes** | yes (`Guarded`) |
| codex | `~/.codex/cc-switch-model-catalog.json` | JSON whole | no | yes (`WholeFile`) |
| codex | `<appcfg>/codex_managed_oauth_live_auth.json` | JSON whole | **yes** | yes (`Guarded`) |
| codex | `~/.cc-switch/codex-login-stash.json` | JSON whole | **yes** | yes (`Guarded`) |
| gemini | `~/.gemini/.env` | `.env` | **yes** | yes (`DotenvPatch`) |
| gemini | `~/.gemini/settings.json` | JSON | no | yes (`JsonPatch`) |
| grokbuild | `~/.grok/config.toml` | TOML | **yes** | yes (`TomlSteps`) |
| claude-desktop | `<normal>/claude_desktop_config.json` | JSON | no | yes |
| claude-desktop | `<3p>/claude_desktop_config.json` | JSON | no | yes |
| claude-desktop | `<3p>/configLibrary/<PROFILE_ID>.json` | JSON | **yes** | yes |
| claude-desktop | `<3p>/configLibrary/_meta.json` | JSON | no | yes |
| opencode | `~/.config/opencode/opencode.json[c]` | JSONC | no | no |
| openclaw | `~/.openclaw/openclaw.json` | JSON5 | no | no |
| hermes | `~/.hermes/config.yaml` | YAML | no | no |
| pi | `~/.pi/agent/models.json` | JSON | **yes** | no |
| mcode | `~/.minimax/config.yaml` | YAML | **yes** | no |

Private flag → `stage_write(path, bytes, Some(0o600), true)`; `atomic_write_private` = `stage_write(..., Some(0o600), false).commit()` (`config.rs:463-478`).

---

# PART 6 — Constants to port verbatim (checklist)

**Claude** — `CLAUDE_PROTOCOL_SELECTORS` (7), `CLAUDE_FLOOR_ENV_PREFIXES` (3), `CLAUDE_FLOOR_ENV_KEYS` (8), skip-auth rule (`CLAUDE_CODE_SKIP_` + `_AUTH`), `CLAUDE_FLOOR_TOP` (13), `CLAUDE_EXCLUSIVE_ENV` (15), `CLAUDE_RESIDUE_ENV` (7 pairs), `BEDROCK_BEARER_ENV`, `PROXY_TOKEN_PLACEHOLDER`, 4 proxy aliases, `ONE_M_MARKER_FOR_CLIENT = "[1M]"`.

**Codex** — `CODEX_FLOOR_TOP` (11), `CODEX_FLOOR_NESTED` (4 paths), `CODEX_PROVIDER_TABLE`, `CODEX_EXCLUSIVE_TOP` (5), `ROUTE_ID`, `OFFICIAL_PROXY_ROUTE_ID`, `OPENAI_BASE_URL`, `CATALOG_FILENAME`, `WEB_SEARCH_DISABLED`, `MODEL_CATALOG_JSON`, `BUILT_IN_IDS` (5), `RESERVED_TABLE_IDS` (3), `DEFAULT_PROVIDER_ID`, `BEDROCK_IDS` (2), `LEGACY_REROUTE_ID`, `ROW_TOP_FIELDS` (5), `STACK_SUNK_WINDOW_KEYS` (2), `CODEX_WEB_SEARCH_REJECT_HOSTS` (12), `CODEX_WEB_SEARCH_REJECT_MODEL_PREFIXES` (5), `STASH_FILENAME`.

**Gemini** — `SELECTED_TYPE_OAUTH/API_KEY`, `BASE_URL_ENV`, `API_KEY_ENV`, `MODEL_ENV`, `gemini_floor_env` prefix + 8 enumerated keys, `GEMINI_FLOOR_SETTINGS` (2 paths).

**Desktop** — `PROFILE_ID`, `PROFILE_NAME`, `CONFIG_FILE`, `CONFIG_LIBRARY_DIR`, `DESKTOP_PROFILE_FLOOR` (5), `DESKTOP_PROFILE_SEED` (2), `LEGACY_ENTERPRISE_GATEWAY_KEYS` (5), `ONE_M_CONTEXT_MARKER = "[1m]"`.

**Shared** — `MAX_REPLANS = 3`, `EDIT_CONFLICT_CODE = "LIVE_EDIT_CONFLICT"`, `CONTRACT_VERSION = 1`, `STATE_VERSION = 1`, `DeviceStore` = `~/.cc-switch/{live-state.json, backups/live-first-write/, codex-login-stash.json}`, `AppType::all()` order.