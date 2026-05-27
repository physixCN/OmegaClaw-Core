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
!(register-default-runtime-spaces)
!(register-space-persistence "persistent" /tmp/omega-persistent-cleanup-persistence-smoke-persistent.metta runtime-state)
!(register-space-persistence "cleanup" /tmp/omega-persistent-cleanup-persistence-smoke.metta runtime-state)

!(add-atom &persistent (PersistentFact "Smoke" "durable-duplicate" "value" "0.9"))
!(add-atom &persistent (PersistentFact "Smoke" "durable-duplicate" "value" "0.9"))

!(eval (persistent-cleanup-candidates 5))
!(eval (persistent-cleanup-propose "pc-23503124d400865c" "merge-duplicate" "durable cleanup proposal smoke"))

!(if (== (match-count &cleanup (PersistentCleanupProposal "pp-6249417b3153a565" "pc-23503124d400865c" "persistent" "merge-duplicate" $expr $replacement "durable cleanup proposal smoke" $risk $confidence "pending")) 1)
     (println! PERSISTENT-CLEANUP-PROPOSAL-BEFORE-RELOAD-OK)
     (println! FAILED-PERSISTENT-CLEANUP-PROPOSAL-BEFORE-RELOAD))

!(collapse (match &cleanup (PersistentCleanupCandidate $id $space $expr $preview $kind $count)
                  (remove-atom &cleanup (PersistentCleanupCandidate $id $space $expr $preview $kind $count))))
!(collapse (match &cleanup (PersistentCleanupProposal $proposal $candidate $space $action $expr $replacement $reason $risk $confidence $status)
                  (remove-atom &cleanup (PersistentCleanupProposal $proposal $candidate $space $action $expr $replacement $reason $risk $confidence $status))))

!(if (== (match-count &cleanup (PersistentCleanupProposal "pp-6249417b3153a565" "pc-23503124d400865c" "persistent" "merge-duplicate" $expr $replacement "durable cleanup proposal smoke" $risk $confidence "pending")) 0)
     (println! PERSISTENT-CLEANUP-CLEARED-BEFORE-RELOAD-OK)
     (println! FAILED-PERSISTENT-CLEANUP-CLEARED-BEFORE-RELOAD))

!(import! &cleanup /tmp/omega-persistent-cleanup-persistence-smoke.metta)

!(if (== (match-count &cleanup (PersistentCleanupProposal "pp-6249417b3153a565" "pc-23503124d400865c" "persistent" "merge-duplicate" $expr $replacement "durable cleanup proposal smoke" $risk $confidence "pending")) 1)
     (println! PERSISTENT-CLEANUP-PROPOSAL-RELOAD-OK)
     (println! FAILED-PERSISTENT-CLEANUP-PROPOSAL-RELOAD))

!(eval (persistent-cleanup-commit "pp-6249417b3153a565"))

!(if (== (match-count &persistent (PersistentFact "Smoke" "durable-duplicate" "value" "0.9")) 1)
     (println! PERSISTENT-CLEANUP-COMMIT-AFTER-RELOAD-OK)
     (println! FAILED-PERSISTENT-CLEANUP-COMMIT-AFTER-RELOAD))
