; Skill implementation loader.
;
; The advertised command catalog lives in ./src/skill_catalog.metta.
; This facade preserves the historical src/skills.metta import while keeping
; organs reviewable by cognitive/body boundary.

!(import! &self (library OmegaClaw-Core ./src/skills_core.metta))
!(import! &self (library OmegaClaw-Core ./src/skills_runtime_spaces.metta))
!(import! &self (library OmegaClaw-Core ./src/skills_memory.metta))
!(import! &self (library OmegaClaw-Core ./src/skills_space_mutation.metta))
