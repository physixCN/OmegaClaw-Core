; Optional attention / ECAN-lite immune organ.

!(import! &self (car-atom (collapse (library OmegaClaw-Core ./src/attention_ledger.py))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core ./src/skill_catalog_attention.metta))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core ./src/skill_affordance_attention.metta))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core ./src/skills_attention.metta))))
!(bind! &attention (new-space))
!(register-space "attention" &attention immune)
!(register-space-alias attention "attention")
!(register-space-persistence "attention" ./repos/OmegaClaw-Core/memory/attention.metta runtime-state)
