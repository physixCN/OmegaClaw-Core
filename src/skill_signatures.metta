; Command syntax membrane declarations (stage 1).
;
; helper_command_parser loads every src/skill_signatures*.metta file. Each
; SkillSignature declares the exact shape of one model-facing command; the
; parser validates fail-closed against these shapes and returns compact,
; actionable recovery hints instead of silently guessing.
;
; Format:
; (SkillSignature command-name (Arg argument-type argument-name) ...)
; (SignatureLowering command-name lowered-command-name)
; (SignatureNoActionHead word)
; (SignatureRecoveryHint error-kind "compact recovery hint")
;
; Argument types: text (one quoted/plain token), rest-text (everything after
; the head, quotes optional), multiline (quoted/triple-quoted body, lowered
; to base64 transport), filepath, shell-command, base64, metta (raw balanced
; MeTTa expression, passed through unevaluated), optional-rest-text, number.

; --- memory and working state ---
(SkillSignature remember (Arg rest-text memory))
(SkillSignature query (Arg rest-text topic))
(SkillSignature episodes (Arg rest-text time))
(SkillSignature pin (Arg rest-text state))

; --- no-action / pacing ---
(SkillSignature wait (Arg rest-text reason))

; --- shell and file I/O ---
(SkillSignature shell (Arg shell-command command))
(SkillSignature read-file (Arg filepath path))
(SkillSignature write-file (Arg filepath path) (Arg multiline content))
(SkillSignature append-file (Arg filepath path) (Arg rest-text line))
(SkillSignature write-file-base64 (Arg filepath path) (Arg base64 payload))
(SkillSignature append-file-base64 (Arg filepath path) (Arg base64 payload))
(SignatureLowering write-file write-file-base64)
(SignatureLowering append-file append-file-base64)

; --- communication and search ---
(SkillSignature send (Arg rest-text message))
(SkillSignature search (Arg rest-text query))
(SkillSignature tavily-search (Arg rest-text query))
(SkillSignature technical-analysis (Arg text ticker))
(SkillSignature get (Arg text url))

; --- code execution ---
(SkillSignature metta (Arg metta expression))
(SkillSignature test-metta (Arg rest-text expression))

; --- prose words that are never commands ---
(SignatureNoActionHead no)
(SignatureNoActionHead none)
(SignatureNoActionHead quiet)
(SignatureNoActionHead silence)
(SignatureNoActionHead waiting)
(SignatureNoActionHead ##)
(SignatureNoActionHead ###)
(SignatureNoActionHead ####)
(SignatureNoActionHead ```)

; --- recovery hints (quoted back to the model on refusal) ---
(SignatureRecoveryHint unknown-head "recover: plain prose is fine for no-action; use wait \"reason\" to deliberately do nothing, or one of the commands listed in TOOLS")
(SignatureRecoveryHint syntax-error "recover: match the exact shape shown in TOOLS; after two failures stop this shape")
(SignatureRecoveryHint invalid-base64 "recover: never produce base64 yourself; the membrane encodes for you. Resend as write-file path with a quoted or triple-quoted body")
(SignatureRecoveryHint missing-argument "recover: check the TOOLS list for the required arguments")
(SignatureRecoveryHint unexpected-trailing "recover: quote text arguments, use the exact arity shown in TOOLS")
(SignatureRecoveryHint metta-syntax "recover: check parenthesis balance and quoting; verify with test-metta before retrying")
(SignatureRecoveryHint invalid-number "recover: use bare numeric values for number args, not words")
