# Compatibility facade for OmegaClaw Python helper functions.
#
# The implementation is split into smaller membranes so core syntax, MeTTa
# atom construction, history lookup, promotion storage, and reboot control can
# be reviewed independently. Existing MeTTa calls keep using helper.* names.

from datetime import datetime
import pathlib
import sys

try:
    from .python_runtime import configure_embedded_python_runtime
except Exception:  # pragma: no cover - direct script import fallback
    from python_runtime import configure_embedded_python_runtime

configure_embedded_python_runtime()

try:
    from .helper_history import (
        extract_timestamp,
        coerce_recall_lines,
        around_time,
        normalize_episode_time,
        episodes_at,
    )
    from .helper_metta import (
        CORE_ROOT,
        OMEGACLAW_ROOT,
        context_prompt,
        context_history_tail,
        context_recent_history_entries,
        context_last_results,
        context_current_frame,
        ensure_runtime_memory_files,
        _escape_metta_string,
        _metta_string,
        _has_unescaped_quote,
        _metta_expr_syntax_error,
        _take_balanced_metta_expr,
        _split_collapsed_space_transform_args,
        _split_with_confidence,
        _pipe_parts,
        _source_trace,
        _numeric_text,
        config_assignment_atom,
        persistent_fact_atom,
        persistent_note_atom,
        persistent_rule_atom,
        world_fact_atom,
        belief_claim_atom,
        agenda_goal_atom,
        agenda_goal_name,
        agenda_goal_name_atom,
        event_note_atom,
        cleanup_candidate_id,
        cleanup_proposal_id,
        cleanup_preview,
        assimilation_event_atom,
        assimilation_world_atom,
        assimilation_belief_atom,
        assimilation_persistent_atom,
        space_transform_spec_atom,
        test_metta_expression,
        persistent_expression_atom,
        run_metta_file,
        _safe_writable_path,
        write_file_base64,
        append_file_base64,
        normalize_string,
    )
    from .helper_command_parser import (
        SignatureParseError,
        SIGNATURE_KNOWN_SPACES,
        SIGNATURE_MULTILINE_LOWERING,
        SIGNATURE_COMMANDS,
        SIGNATURE_DECLARATIONS_PATH,
        _strip_signature_comment,
        _load_signature_commands,
        signature_commands_from,
        signature_spaces_from,
        signature_lowerings_from,
        signature_declaration_paths,
        skill_catalog_declaration_paths,
        skill_catalog,
        skill_help,
        reload_signature_commands,
        _signature_quote,
        _signature_one_line,
        _signature_consume_token,
        _signature_validated_metta,
        _signature_consume_metta,
        _signature_split_commands,
        _signature_explicit_command_head,
        _signature_accepts_unquoted_continuation,
        _signature_merge_continuations,
        _signature_extract_block,
        _signature_syntax_error,
        _signature_parse_one,
        signature_balance_parentheses,
        balance_parentheses,
    )
    from .helper_recall import (
        context_input_recall,
        context_input_recall_text,
        dialogue_frame,
        dialogue_recall_basis_text,
    )
    from .helper_skill_recall import (
        input_skill_signals,
        input_skill_signals_expr,
    )
    from .helper_promotion import (
        promotion_open_map,
        promotion_key,
        promotion_set_value,
        promotion_get_value,
        promotion_get_all_keys,
        promotion_set_lasttime,
        promotion_get_lasttime,
        promotion_has_key,
        promotion_delete_key,
        promotion_commit,
        promotion_close_map,
    )
    from .helper_reboot import (
        current_swipl_pid,
        _reboot_note_path,
        _latest_reboot_line,
        prepare_reboot,
        complete_reboot_check,
        restart_omega,
        restart_self,
        reboot_self,
    )
except Exception:
    from helper_history import (
        extract_timestamp, coerce_recall_lines, around_time, normalize_episode_time, episodes_at,
    )
    from helper_metta import (
        CORE_ROOT,
        OMEGACLAW_ROOT,
        context_prompt,
        context_history_tail,
        context_recent_history_entries,
        context_last_results,
        context_current_frame,
        ensure_runtime_memory_files,
        _escape_metta_string,
        _metta_string,
        _has_unescaped_quote,
        _metta_expr_syntax_error,
        _take_balanced_metta_expr,
        _split_collapsed_space_transform_args,
        _split_with_confidence,
        _pipe_parts,
        _source_trace,
        _numeric_text,
        config_assignment_atom,
        persistent_fact_atom,
        persistent_note_atom,
        persistent_rule_atom,
        world_fact_atom,
        belief_claim_atom,
        agenda_goal_atom,
        agenda_goal_name,
        agenda_goal_name_atom,
        event_note_atom,
        cleanup_candidate_id,
        cleanup_proposal_id,
        cleanup_preview,
        assimilation_event_atom,
        assimilation_world_atom,
        assimilation_belief_atom,
        assimilation_persistent_atom,
        space_transform_spec_atom,
        test_metta_expression,
        persistent_expression_atom,
        run_metta_file,
        _safe_writable_path,
        write_file_base64,
        append_file_base64,
        normalize_string,
    )
    from helper_command_parser import (
        SignatureParseError,
        SIGNATURE_KNOWN_SPACES,
        SIGNATURE_MULTILINE_LOWERING,
        SIGNATURE_COMMANDS,
        SIGNATURE_DECLARATIONS_PATH,
        _strip_signature_comment,
        _load_signature_commands,
        signature_commands_from,
        signature_spaces_from,
        signature_lowerings_from,
        signature_declaration_paths,
        skill_catalog_declaration_paths,
        skill_catalog,
        skill_help,
        reload_signature_commands,
        _signature_quote,
        _signature_one_line,
        _signature_consume_token,
        _signature_validated_metta,
        _signature_consume_metta,
        _signature_split_commands,
        _signature_explicit_command_head,
        _signature_accepts_unquoted_continuation,
        _signature_merge_continuations,
        _signature_extract_block,
        _signature_syntax_error,
        _signature_parse_one,
        signature_balance_parentheses,
        balance_parentheses,
    )
    from helper_recall import (
        context_input_recall,
        context_input_recall_text,
        dialogue_frame,
        dialogue_recall_basis_text,
    )
    from helper_skill_recall import (
        input_skill_signals,
        input_skill_signals_expr,
    )
    from helper_promotion import (
        promotion_open_map,
        promotion_key,
        promotion_set_value,
        promotion_get_value,
        promotion_get_all_keys,
        promotion_set_lasttime,
        promotion_get_lasttime,
        promotion_has_key,
        promotion_delete_key,
        promotion_commit,
        promotion_close_map,
    )
    from helper_reboot import (
        current_swipl_pid,
        _reboot_note_path,
        _latest_reboot_line,
        prepare_reboot,
        complete_reboot_check,
        restart_omega,
        restart_self,
        reboot_self,
    )


def add_python_path(path):
    """Add a repo-relative or absolute Python import path for an enabled module."""
    candidate = pathlib.Path(str(path))
    if not candidate.is_absolute():
        candidate = CORE_ROOT / candidate
    value = str(candidate.resolve())
    if value not in sys.path:
        sys.path.insert(0, value)
    return f"PythonPathAdded {value}"


def test_balance_parenthesis():
	assert balance_parentheses('write-file test.txt hello world') == '((write-file-base64 "test.txt" "aGVsbG8gd29ybGQ="))'
	assert balance_parentheses('send test.xt hello world') == '((send "test.xt hello world"))'
	assert balance_parentheses('turn-off Living') == '((wait "ignored unknown command head turn-off; use only commands listed in SKILLS"))'
	assert balance_parentheses('episodes-at 2026-05-17 21:00') == '((episodes-at "2026-05-17 21:00"))'
	assert balance_parentheses('belief-revision-candidate TestPerson lunch-preference example-preference 0.7 0.6') == '((belief-revision-candidate "TestPerson" "lunch-preference" "example-preference" 0.7 0.6))'
	assert normalize_episode_time('2026-05-17 21:00', datetime(2026, 5, 17, 21, 42, 30)) == '2026-05-17 21:00:00'
	assert normalize_episode_time('21:00', datetime(2026, 5, 17, 21, 42, 30)) == '2026-05-17 21:00:00'
	assert coerce_recall_lines(['maxEpisodeRecallLines']) == 20
	assert coerce_recall_lines('3.0') == 3
	assert coerce_recall_lines(999) == 200
	assert persistent_fact_atom('the agent learned wait-skill 0.8') == '(PersistentFact "the agent" "learned" "wait-skill" "0.8")'
	assert persistent_fact_atom('the agent learned wait-skill high') == '(PersistentFactError "expected: subject relation object confidence; confidence must be numeric")'
	assert persistent_note_atom('syntax use episodes-at instead of episodes 0.8') == '(PersistentNote "syntax" "use episodes-at instead of episodes" "0.8")'
	assert persistent_note_atom('syntax use episodes-at instead of episodes high') == '(PersistentNoteError "expected: topic note confidence; confidence must be numeric")'
	assert persistent_rule_atom('no input | implies | use wait not prose | 0.8') == '(PersistentRule "no input" "implies" "use wait not prose" "0.8")'
	assert persistent_rule_atom('no input | implies | use wait not prose | high') == '(PersistentRuleError "expected: premise | relation | conclusion | confidence; confidence must be numeric")'
	assert space_transform_spec_atom('persistent | (A "x") | events | (B "y") | merge duplicate') == '(SpaceTransformSpec "persistent" "(A \\"x\\")" "events" "(B \\"y\\")" "merge duplicate")'
	assert persistent_expression_atom('Implication (Inheritance living-room comfortable) (Inheritance living-room happy) (stv 0.45 0.5)') == '(Implication (Inheritance living-room comfortable) (Inheritance living-room happy) (stv 0.45 0.5))'
	assert test_metta_expression('(match &persistent (Implication $X $Y) (Implication $X $Y))') == 'METTA-SYNTAX-OK'
	assert test_metta_expression('match &persistent (Implication $X $Y)').startswith('METTA-SYNTAX-ERROR')

if __name__ == "__main__":
    test_balance_parenthesis()
