!(import! &self (library lib_import))
!(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw_no_agentverse))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw_attention))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw_body))))

!(omegaclaw)
