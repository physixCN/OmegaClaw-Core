; Optional module enablement point.
;
; A module is enabled only when this file imports its entry.metta file:
;
; !(import! &self (library OmegaClaw-Core ./modules/example/entry.metta))
;
; The syntax and catalog membranes read this same loader to decide which
; modules can contribute signatures.metta and catalog.metta declarations. This
; keeps installed-but-disabled module folders from becoming parser-visible.
