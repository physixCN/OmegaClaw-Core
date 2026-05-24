# Extracted from helper.py to keep OmegaClaw membranes reviewable.
import base64
import os
import pathlib
import re
import subprocess

CORE_ROOT = pathlib.Path(__file__).resolve().parents[1]
OMEGACLAW_ROOT = CORE_ROOT.parents[1]
MEMORY_DIR = pathlib.Path(os.environ.get("OMEGACLAW_MEMORY_DIR", CORE_ROOT / "memory"))

def _read_text_tail(path, max_chars):
    try:
        max_chars = max(0, int(float(max_chars)))
    except Exception:
        max_chars = 0
    try:
        text = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        return f"CONTEXT-READ-ERROR {type(exc).__name__}: {exc}"
    if max_chars and len(text) > max_chars:
        return text[-max_chars:]
    return text

def context_prompt(max_chars=20000):
    """Read the persona prompt as text for the loop context membrane."""
    path = MEMORY_DIR / "prompt.txt"
    if not path.exists():
        return ""
    return _read_text_tail(path, max_chars)

def context_history_tail(max_chars=30000):
    """Read the history tail as text for the loop context membrane."""
    path = MEMORY_DIR / "history.metta"
    if not path.exists():
        return ""
    return _read_text_tail(path, max_chars)

_SAFE_MEMORY_NAME = re.compile(r"^[A-Za-z0-9_-]+$")


def ensure_runtime_memory_files(names=""):
    """Create empty ignored runtime MeTTa memory files when absent.

    Persistence policy lives in MeTTa/module declarations.  This helper is only
    the filesystem membrane: it creates requested safe filenames under the
    configured memory directory and refuses path-like names.
    """
    requested = [part.strip() for part in str(names or "").replace(",", " ").split() if part.strip()]
    created = []
    existing = []
    rejected = []
    memory_dir = MEMORY_DIR
    memory_dir.mkdir(parents=True, exist_ok=True)
    for name in requested:
        if not _SAFE_MEMORY_NAME.fullmatch(name):
            rejected.append(name)
            continue
        path = memory_dir / f"{name}.metta"
        if path.exists():
            existing.append(name)
            continue
        path.write_text("", encoding="utf-8")
        created.append(name)
    return (
        f"RUNTIME-MEMORY-FILES existing={','.join(existing)} "
        f"created={','.join(created)} rejected={','.join(rejected)}"
    )

def _escape_metta_string(text):
    escaped = []
    for ch in str(text or ""):
        if ch == "\\":
            escaped.append("\\\\")
        elif ch == '"':
            escaped.append('\\"')
        elif ch == "\n":
            escaped.append("\\n")
        elif ch == "\r":
            escaped.append("\\r")
        elif ch == "\t":
            escaped.append("\\t")
        elif ord(ch) < 32 or ord(ch) == 127:
            escaped.append(f"\\x{ord(ch):02x}")
        else:
            escaped.append(ch)
    return "".join(escaped)


def _metta_string(text):
    return '"' + _escape_metta_string(text) + '"'

def _has_unescaped_quote(text):
    escaped = False
    for ch in str(text or ""):
        if ch == '"' and not escaped:
            return True
        escaped = (ch == "\\" and not escaped)
        if ch != "\\":
            escaped = False
    return False

def _metta_expr_syntax_error(expr):
    text = str(expr or "").strip()
    if not text:
        return "empty expression"
    depth = 0
    in_quote = False
    escaped = False
    for ch in text:
        if in_quote:
            if ch == '"' and not escaped:
                in_quote = False
            escaped = (ch == "\\" and not escaped)
            if ch != "\\":
                escaped = False
            continue
        if ch == '"':
            in_quote = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return "too many closing parentheses"
    if in_quote:
        return "unterminated string"
    if depth > 0:
        return "missing closing parenthesis"
    return ""

def _take_balanced_metta_expr(text):
    text = str(text or "").strip()
    if not text.startswith("("):
        return "", text
    depth = 0
    in_quote = False
    escaped = False
    for idx, ch in enumerate(text):
        if in_quote:
            if ch == '"' and not escaped:
                in_quote = False
            escaped = (ch == "\\" and not escaped)
            if ch != "\\":
                escaped = False
            continue
        if ch == '"':
            in_quote = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return text[:idx + 1], text[idx + 1:].strip()
            if depth < 0:
                return "", text
    return "", text

DEFAULT_KNOWN_SPACES = {"persistent", "agenda", "beliefs", "world", "events", "activity", "assume", "attention"}


def _split_collapsed_space_transform_args(spec, known_spaces=None):
    text = str(spec or "").strip()
    if not _has_unescaped_quote(text):
        text = re.sub(r'\\+"', '"', text)
    if not text:
        return []
    known_spaces = set(known_spaces or DEFAULT_KNOWN_SPACES)
    source_match = re.match(r"^([A-Za-z_-]+)\s+", text)
    if not source_match:
        return []
    source = source_match.group(1)
    if source not in known_spaces:
        return []
    rest = text[source_match.end():].strip()
    pattern, rest = _take_balanced_metta_expr(rest)
    if not pattern or _metta_expr_syntax_error(pattern):
        return []
    target_match = re.match(r"^([A-Za-z_-]+)\s+", rest)
    if not target_match:
        return []
    target = target_match.group(1)
    if target not in known_spaces:
        return []
    rest = rest[target_match.end():].strip()
    replacement, reason = _take_balanced_metta_expr(rest)
    if not replacement or _metta_expr_syntax_error(replacement):
        return []
    reason = reason.strip()
    if not reason:
        return []
    return [source, pattern, target, replacement, reason]

def _split_with_confidence(spec, minimum_parts):
    parts = str(spec or "").strip().split()
    if len(parts) < minimum_parts:
        return None
    confidence = parts[-1]
    return parts, confidence

def persistent_fact_atom(spec):
    parsed = _split_with_confidence(spec, 4)
    if not parsed:
        return '(PersistentFactError "expected: subject relation object confidence")'
    parts, confidence = parsed
    if _numeric_text(confidence) is None:
        return '(PersistentFactError "expected: subject relation object confidence; confidence must be numeric")'
    subject = parts[0]
    relation = parts[1]
    obj = " ".join(parts[2:-1])
    return f"(PersistentFact {_metta_string(subject)} {_metta_string(relation)} {_metta_string(obj)} {_metta_string(confidence)})"

def persistent_note_atom(spec):
    parsed = _split_with_confidence(spec, 3)
    if not parsed:
        return '(PersistentNoteError "expected: topic note confidence")'
    parts, confidence = parsed
    if _numeric_text(confidence) is None:
        return '(PersistentNoteError "expected: topic note confidence; confidence must be numeric")'
    topic = parts[0]
    note = " ".join(parts[1:-1])
    return f"(PersistentNote {_metta_string(topic)} {_metta_string(note)} {_metta_string(confidence)})"

def persistent_rule_atom(spec):
    text = str(spec or "").strip()
    parts = [part.strip() for part in text.split("|")]
    if len(parts) == 4 and all(parts):
        premise, relation, conclusion, confidence = parts
    else:
        parsed = _split_with_confidence(text, 4)
        if not parsed:
            return '(PersistentRuleError "expected: premise | relation | conclusion | confidence")'
        raw_parts, confidence = parsed
        premise = raw_parts[0]
        relation = raw_parts[1]
        conclusion = " ".join(raw_parts[2:-1])
    if _numeric_text(confidence) is None:
        return '(PersistentRuleError "expected: premise | relation | conclusion | confidence; confidence must be numeric")'
    return f"(PersistentRule {_metta_string(premise)} {_metta_string(relation)} {_metta_string(conclusion)} {_metta_string(confidence)})"

def world_fact_atom(spec):
    parsed = _split_with_confidence(spec, 4)
    if not parsed:
        return '(WorldFactError "expected: subject relation object confidence")'
    parts, confidence = parsed
    if _numeric_text(confidence) is None:
        return '(WorldFactError "expected: subject relation object confidence; confidence must be numeric")'
    subject = parts[0]
    relation = parts[1]
    obj = " ".join(parts[2:-1])
    return f"(Relation {_metta_string(subject)} {_metta_string(relation)} {_metta_string(obj)} {_metta_string(confidence)} \"omega\")"


def belief_claim_atom(spec):
    parts = str(spec or "").strip().split()
    if len(parts) < 5:
        return '(BeliefClaimError "expected: domain relation value frequency confidence")'
    domain = parts[0]
    relation = parts[1]
    frequency = parts[-2]
    confidence = parts[-1]
    if _numeric_text(frequency) is None or _numeric_text(confidence) is None:
        return '(BeliefClaimError "expected: domain relation value frequency confidence; frequency and confidence must be numeric")'
    value = " ".join(parts[2:-2])
    return f"(Belief {_metta_string(domain)} {_metta_string(relation)} {_metta_string(value)} (stv {frequency} {confidence}) \"omega\")"


def agenda_goal_atom(spec):
    parts = str(spec or "").strip().split()
    if len(parts) < 4:
        return '(AgendaGoalError "expected: name status priority next")'
    name = parts[0]
    status = parts[1]
    priority = parts[2]
    next_step = " ".join(parts[3:])
    allowed_status = {"active", "waiting", "blocked", "scheduled", "dormant"}
    allowed_priority = {"low", "medium", "high"}
    if status not in allowed_status:
        return f'(AgendaGoalError {_metta_string("status must be active, waiting, blocked, scheduled, or dormant")})'
    if priority not in allowed_priority:
        return f'(AgendaGoalError {_metta_string("priority must be low, medium, or high")})'
    return f"(Goal {_metta_string(name)} {status} {priority} {_metta_string(next_step)})"

def agenda_goal_name(spec):
    parts = str(spec or "").strip().split()
    if len(parts) < 4:
        return ""
    status = parts[1]
    allowed = {"active", "waiting", "blocked", "scheduled", "dormant"}
    if status not in allowed:
        return ""
    return parts[0]

def agenda_goal_name_atom(spec):
    name = agenda_goal_name(spec)
    return _metta_string(name)


def event_note_atom(spec):
    parsed = _split_with_confidence(spec, 4)
    if not parsed:
        return '(EventNoteError "expected: source kind summary confidence")'
    parts, confidence = parsed
    if _numeric_text(confidence) is None:
        return '(EventNoteError "expected: source kind summary confidence; confidence must be numeric")'
    source = parts[0]
    kind = parts[1]
    summary = " ".join(parts[2:-1])
    return f"(Event {_metta_string(source)} {_metta_string(kind)} {_metta_string(summary)} {_metta_string(confidence)})"


def _pipe_parts(spec):
    return [part.strip() for part in str(spec or "").strip().split("|")]


def _source_trace(source, trace):
    source = str(source or "").strip()
    trace = str(trace or "").strip()
    return f"{source}:{trace}" if trace else source


def _numeric_text(value):
    text = str(value or "").strip()
    try:
        float(text)
    except Exception:
        return None
    return text


def assimilation_event_atom(spec):
    parts = _pipe_parts(spec)
    if len(parts) < 5 or not all(parts[:3]) or not parts[-1]:
        return '(AssimilationEventError "expected: source | trace_id | kind | summary | confidence")'
    confidence = parts[-1]
    if _numeric_text(confidence) is None:
        return '(AssimilationEventError "expected: source | trace_id | kind | summary | confidence; confidence must be numeric")'
    source, trace, kind = parts[:3]
    summary = " | ".join(parts[3:-1]).strip()
    if not summary:
        return '(AssimilationEventError "summary cannot be empty")'
    return f"(ObservationEvent {_metta_string(source)} {_metta_string(trace)} {_metta_string(kind)} {_metta_string(summary)} {_metta_string(confidence)})"


def assimilation_world_atom(spec):
    parts = _pipe_parts(spec)
    if len(parts) < 6 or not all(parts[:4]) or not parts[-1]:
        return '(AssimilationWorldError "expected: source | trace_id | subject | relation | object | confidence")'
    confidence = parts[-1]
    if _numeric_text(confidence) is None:
        return '(AssimilationWorldError "expected: source | trace_id | subject | relation | object | confidence; confidence must be numeric")'
    source, trace, subject, relation = parts[:4]
    obj = " | ".join(parts[4:-1]).strip()
    if not obj:
        return '(AssimilationWorldError "object cannot be empty")'
    return f"(Relation {_metta_string(subject)} {_metta_string(relation)} {_metta_string(obj)} {_metta_string(confidence)} {_metta_string(_source_trace(source, trace))})"


def assimilation_belief_atom(spec):
    parts = _pipe_parts(spec)
    if len(parts) < 7 or not all(parts[:4]) or not parts[-2] or not parts[-1]:
        return '(AssimilationBeliefError "expected: source | trace_id | domain | relation | value | frequency | confidence")'
    source, trace, domain, relation = parts[:4]
    frequency = _numeric_text(parts[-2])
    confidence = _numeric_text(parts[-1])
    value = " | ".join(parts[4:-2]).strip()
    if not value:
        return '(AssimilationBeliefError "value cannot be empty")'
    if frequency is None or confidence is None:
        return '(AssimilationBeliefError "frequency and confidence must be numeric")'
    return f"(Belief {_metta_string(domain)} {_metta_string(relation)} {_metta_string(value)} (stv {frequency} {confidence}) {_metta_string(_source_trace(source, trace))})"


def assimilation_persistent_atom(spec):
    parts = _pipe_parts(spec)
    if len(parts) < 5 or not all(parts[:3]) or not parts[-1]:
        return '(AssimilationPersistentError "expected: source | trace_id | topic | note | confidence")'
    confidence = parts[-1]
    if _numeric_text(confidence) is None:
        return '(AssimilationPersistentError "expected: source | trace_id | topic | note | confidence; confidence must be numeric")'
    source, trace, topic = parts[:3]
    note = " | ".join(parts[3:-1]).strip()
    if not note:
        return '(AssimilationPersistentError "note cannot be empty")'
    return f"(PersistentObservation {_metta_string(source)} {_metta_string(trace)} {_metta_string(topic)} {_metta_string(note)} {_metta_string(confidence)})"


def space_transform_spec_atom(spec):
    parts = _pipe_parts(spec)
    if len(parts) != 5 or not all(parts):
        return '(SpaceTransformSpecError "expected: source_space | pattern_expression | target_space | replacement_expression | reason")'
    source, pattern, target, replacement, reason = parts
    pattern_error = _metta_expr_syntax_error(pattern)
    if pattern_error:
        return f'(SpaceTransformSpecError "bad pattern expression: {pattern_error}")'
    replacement_error = _metta_expr_syntax_error(replacement)
    if replacement_error:
        return f'(SpaceTransformSpecError "bad replacement expression: {replacement_error}")'
    return (
        f"(SpaceTransformSpec {_metta_string(source)} {_metta_string(pattern)} "
        f"{_metta_string(target)} {_metta_string(replacement)} {_metta_string(reason)})"
    )


def test_metta_expression(expr):
    text = str(expr or "").strip()
    if not text:
        return "METTA-SYNTAX-ERROR empty expression"
    if not (text.startswith("(") and text.endswith(")")):
        return "METTA-SYNTAX-ERROR expression should be one complete parenthesized MeTTa expression"
    depth = 0
    in_quote = False
    escaped = False
    for index, ch in enumerate(text):
        if ch == '"' and not escaped:
            in_quote = not in_quote
        elif not in_quote:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth < 0:
                    return f"METTA-SYNTAX-ERROR extra closing parenthesis near offset {index}"
        escaped = (ch == "\\" and not escaped)
        if ch != "\\":
            escaped = False
    if in_quote:
        return "METTA-SYNTAX-ERROR unterminated quote"
    if depth != 0:
        return "METTA-SYNTAX-ERROR unbalanced parentheses"
    return "METTA-SYNTAX-OK"

def persistent_expression_atom(expr):
    text = str(expr or "").strip()
    if not text:
        return '(PersistentExpressionError "empty expression")'
    if not text.startswith("("):
        text = "(" + text + ")"
    elif not text.endswith(")"):
        text = text + ")"
    status = test_metta_expression(text)
    if status != "METTA-SYNTAX-OK":
        return f'(PersistentExpressionError {_metta_string(status)})'
    return text

def run_metta_file(path, timeout_seconds=20, max_chars=12000):
    raw = str(path or "").strip().strip('"')
    if not raw:
        return "RUN-METTA-FILE-ERROR empty filepath"
    raw_is_tmp = raw == "/tmp" or raw.startswith("/tmp/")
    candidate = pathlib.Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = (OMEGACLAW_ROOT / candidate).resolve()
    else:
        candidate = candidate.resolve()
    try:
        candidate.relative_to(OMEGACLAW_ROOT)
    except ValueError:
        if not raw_is_tmp:
            return f"RUN-METTA-FILE-ERROR path outside OmegaClaw or /tmp: {candidate}"
    if candidate.suffix != ".metta":
        return f"RUN-METTA-FILE-ERROR expected .metta file: {candidate}"
    if not candidate.exists():
        return f"RUN-METTA-FILE-ERROR file not found: {candidate}"
    env = os.environ.copy()
    env["OMEGACLAW_RUN_INNER"] = "1"
    try:
        proc = subprocess.run(
            ["./run.sh", str(candidate)],
            cwd=str(OMEGACLAW_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            timeout=int(timeout_seconds),
        )
        output = proc.stdout or ""
        if len(output) > int(max_chars):
            output = output[-int(max_chars):]
            output = "[output truncated to tail]\n" + output
        return f"RUN-METTA-FILE-EXIT {proc.returncode}\n{output}"
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        if len(output) > int(max_chars):
            output = output[-int(max_chars):]
        return f"RUN-METTA-FILE-TIMEOUT after {timeout_seconds}s\n{output}"
    except Exception as exc:
        return f"RUN-METTA-FILE-ERROR {type(exc).__name__}: {exc}"

def _safe_writable_path(raw):
    raw = str(raw or "").strip().strip('"')
    if not raw:
        return None, "empty filepath"
    raw_is_tmp = raw == "/tmp" or raw.startswith("/tmp/")
    candidate = pathlib.Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = (OMEGACLAW_ROOT / candidate).resolve()
    else:
        candidate = candidate.resolve()
    try:
        candidate.relative_to(OMEGACLAW_ROOT)
    except ValueError:
        if not raw_is_tmp:
            return None, f"path outside OmegaClaw or /tmp: {candidate}"
    return candidate, None

def write_file_base64(path, payload):
    target, error = _safe_writable_path(path)
    if error:
        return f"WRITE-FILE-BASE64-ERROR {error}"
    text = str(payload or "").strip().replace(" ", "").replace("\n", "")
    if not text:
        return "WRITE-FILE-BASE64-ERROR empty payload"
    try:
        data = base64.b64decode(text, validate=True)
    except Exception as exc:
        return f"WRITE-FILE-BASE64-ERROR invalid base64: {exc}"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + f".tmp-{os.getpid()}")
        tmp.write_bytes(data)
        os.replace(tmp, target)
        return f"WRITE-FILE-BASE64-SUCCESS path={target} bytes={len(data)}"
    except Exception as exc:
        return f"WRITE-FILE-BASE64-ERROR {type(exc).__name__}: {exc}"

def append_file_base64(path, payload):
    target, error = _safe_writable_path(path)
    if error:
        return f"APPEND-FILE-BASE64-ERROR {error}"
    text = str(payload or "").strip().replace(" ", "").replace("\n", "")
    if not text:
        return "APPEND-FILE-BASE64-ERROR empty payload"
    try:
        data = base64.b64decode(text, validate=True)
    except Exception as exc:
        return f"APPEND-FILE-BASE64-ERROR invalid base64: {exc}"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("ab") as f:
            f.write(data)
        return f"APPEND-FILE-BASE64-SUCCESS path={target} bytes={len(data)}"
    except Exception as exc:
        return f"APPEND-FILE-BASE64-ERROR {type(exc).__name__}: {exc}"

def normalize_string(x):
    try:
        if isinstance(x, bytes):
            return x.decode("utf-8", errors="ignore")
        return str(x).encode("utf-8", errors="ignore").decode("utf-8", errors="ignore")
    except Exception:
        return str(x)
