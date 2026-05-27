!(import! &self (library lib_import))
!(import! &self (library lib_spaces))
!(git-import! "https://github.com/asi-alliance/OmegaClaw-Core.git")

!(bind! &persistent (new-space))
!(bind! &cleanup (new-space))
!(bind! &events (new-space))
!(bind! &world (new-space))
!(bind! &beliefs (new-space))
!(bind! &agenda (new-space))
!(bind! &activity (new-space))

!(import! &self (library OmegaClaw-Core ./src/skills))

!(add-atom &persistent (PersistentFact "Smoke" "duplicate" "value" "0.9"))
!(add-atom &persistent (PersistentFact "Smoke" "duplicate" "value" "0.9"))

!(eval (persistent-cleanup-candidates 5))

!(eval (persistent-cleanup-propose "pc-c69d502013cdb675" "merge-duplicate" "smoke exact duplicate"))

!(if (== (match-count &cleanup (PersistentCleanupProposal "pp-0e11c78d613adc8f" "pc-c69d502013cdb675" "persistent" "merge-duplicate" $expr $replacement "smoke exact duplicate" $risk $confidence "pending")) 1)
     (println! PERSISTENT-CLEANUP-PROPOSE-QUOTED-ID-OK)
     (println! FAILED-PERSISTENT-CLEANUP-PROPOSE-QUOTED-ID))

!(eval (persistent-cleanup-commit "pp-0e11c78d613adc8f"))

!(if (== (match-count &persistent (PersistentFact "Smoke" "duplicate" "value" "0.9")) 1)
     (println! PERSISTENT-CLEANUP-COMMIT-QUOTED-ID-OK)
     (println! FAILED-PERSISTENT-CLEANUP-COMMIT-QUOTED-ID))
