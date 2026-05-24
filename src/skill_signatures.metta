; Experimental command syntax membrane declarations.
;
; The command reader loads every src/skill_signatures*.metta file. Keep this
; file as the common orientation layer; organs add their own signature files
; beside it so the syntax membrane remains generic and composable.
;
; Format:
; (SkillSignature command-name (Arg argument-type argument-name) ...)
; (SignatureSpace symbolic-space-name)
; (SignatureLowering command-name lowered-command-name)
; (SignatureShorthand command-name pipe|collapsed (Field argument-type name) ...)
; (SignatureNoActionHead word)

(SignatureNoActionHead no)
(SignatureNoActionHead none)
(SignatureNoActionHead quiet)
(SignatureNoActionHead silence)
(SignatureNoActionHead genuine)
(SignatureNoActionHead waiting)
