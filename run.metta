!(import! &self (library lib_import))
!(git-import! "https://github.com/physixCN/OmegaClaw-Core.git")
!(import! &self (car-atom (collapse (library OmegaClaw-Core ./modules/loader.metta))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw_no_agentverse))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core lib_omegaclaw_attention))))

!(omegaclaw)
