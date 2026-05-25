; Symbolic skill affordance registry.
;
; This is an inspectable skill directory in AtomSpace form. It answers
; "what should I use for this?" with MeTTa atoms rather than a hidden Python
; router. Runtime skills remain normal skills; this organ only exposes compact
; guidance for attention, context economy, and module discovery.

!(bind! &skills (new-space))
!(register-space "skills" &skills affordance)
!(register-space-alias skills "skills")

; Registry schema:
; (Skill "name")
; (SkillTopic "name" "topic")
; (SkillArg "name" index "type" "arg-name")
; (SituationFeature "situation" "feature")
; (PreferredWhen "skill" "feature" confidence "why")
; (Risk "skill" "risk")
; (Effect "skill" "effect")
; (SkillCardLine "skill" "human-readable compact line")
; (SkillTrigger "skill" "signal" confidence "why")
; (CandidateSkillTrigger "skill" "signal" confidence "why")
; (SkillRecall "signal" "skill" confidence "why" "compact card line")

(= (skill-topic-cards $space $topic)
   (collapse (match $space (SkillTopic $skill $topic)
                    (SkillCard $topic $skill))))

(= (skill-topic-cards-normalized $space $topic)
   (list_to_set (append (skill-topic-cards $space $topic)
                        (skill-topic-cards $space (repr $topic)))))

(= (query-skill-space $topic)
   (list_to_set (append (skill-topic-cards-normalized &skills $topic)
                        (skill-topic-cards-normalized &self $topic))))

(= (skill-choices $space $situation)
   (collapse (match $space (SituationFeature $situation $feature)
                    (match $space (PreferredWhen $skill $feature $confidence $why)
                           (SkillChoice $situation $skill $confidence $why)))))

(= (skill-choices-normalized $space $situation)
   (list_to_set (append (skill-choices $space $situation)
                        (skill-choices $space (repr $situation)))))

(= (choose-skill-for $situation)
   (list_to_set (append (skill-choices-normalized &skills $situation)
                        (skill-choices-normalized &self $situation))))

(= (skill-args-normalized $space $skill)
   (let $symbol (repr $skill)
        (append (collapse (match $space (SkillArg $skill $index $type $name)
                                 (SkillCardArg $skill $index $type $name)))
                (collapse (match $space (SkillArg $symbol $index $type $name)
                                 (SkillCardArg $symbol $index $type $name))))))

(= (skill-risks-normalized $space $skill)
   (let $symbol (repr $skill)
        (append (collapse (match $space (Risk $skill $risk)
                                 (SkillRisk $skill $risk)))
                (collapse (match $space (Risk $symbol $risk)
                                 (SkillRisk $symbol $risk))))))

(= (skill-effects-normalized $space $skill)
   (let $symbol (repr $skill)
        (append (collapse (match $space (Effect $skill $effect)
                                 (SkillEffect $skill $effect)))
                (collapse (match $space (Effect $symbol $effect)
                                 (SkillEffect $symbol $effect))))))

(= (explain-skill $skill)
   (list_to_set
     (append (append (append (skill-args-normalized &skills $skill)
                             (skill-risks-normalized &skills $skill))
                     (skill-effects-normalized &skills $skill))
             (append (append (skill-args-normalized &self $skill)
                             (skill-risks-normalized &self $skill))
                     (skill-effects-normalized &self $skill)))))

(= (skill-card-lines-normalized $space $skill)
   (let $symbol (repr $skill)
        (append (collapse (match $space (SkillCardLine $skill $line)
                                 (SkillCardLine $skill $line)))
                (collapse (match $space (SkillCardLine $symbol $line)
                                 (SkillCardLine $symbol $line))))))

(= (skill-card $skill)
   (list_to_set (append (skill-card-lines-normalized &skills $skill)
                        (skill-card-lines-normalized &self $skill))))

(= (skill-trigger-suggestions $space $signal)
   (collapse (match $space (SkillTrigger $skill $signal $confidence $why)
                    (AttentionSkillSuggestion $signal $skill $confidence $why))))

(= (skill-trigger-suggestions-normalized $space $signal)
   (let $symbol (repr $signal)
        (list_to_set (append (skill-trigger-suggestions $space $signal)
                             (skill-trigger-suggestions $space $symbol)))))

(= (skill-suggestions-for $signal)
   (list_to_set (append (skill-trigger-suggestions-normalized &skills $signal)
                        (skill-trigger-suggestions-normalized &self $signal))))

(= (skill-recall-card-lines $space $signal)
   (collapse (match $space (SkillTrigger $skill $signal $confidence $why)
                    (match $space (SkillCardLine $skill $line)
                           (SkillRecall $signal $skill $confidence $why $line)))))

(= (skill-recall-card-lines-normalized $space $signal)
   (let $symbol (repr $signal)
        (list_to_set (append (skill-recall-card-lines $space $signal)
                             (skill-recall-card-lines $space $symbol)))))

(= (skill-recall-cards-for-signal $signal)
   (list_to_set (append (skill-recall-card-lines-normalized &skills $signal)
                        (skill-recall-card-lines-normalized &self $signal))))

(= (skill-recall-cards-for-signals ())
   ())

(= (skill-recall-cards-for-signals $signals)
   (append (skill-recall-cards-for-signal (car-atom $signals))
           (skill-recall-cards-for-signals (cdr-atom $signals))))

(= (skill-recall $msgnew $msg)
   (if $msgnew
       (let* (($signals (car-atom (collapse (sread (py-call (helper.input_skill_signals_expr (string-safe $msg)))))))
              ($cards (list_to_set (skill-recall-cards-for-signals $signals))))
             (repr $cards))
       ""))

(= (skill-trigger-candidates)
   (list_to_set (append (collapse (match &skills (CandidateSkillTrigger $skill $signal $confidence $why)
                                         (CandidateSkillTrigger $skill $signal $confidence $why)))
                        (collapse (match &self (CandidateSkillTrigger $skill $signal $confidence $why)
                                         (CandidateSkillTrigger $skill $signal $confidence $why))))))

(= (suggest-skill-trigger $skill $signal $confidence $reason)
   (progn (add-atom &skills (CandidateSkillTrigger $skill $signal $confidence $reason))
          (CandidateSkillTriggerAdded $skill $signal $confidence $reason)))

(= (add-skill-trigger $skill $signal $confidence $reason)
   (progn (add-atom &skills (SkillTrigger $skill $signal $confidence $reason))
          (SkillTriggerAdded $skill $signal $confidence $reason)))

(= (promote-skill-trigger $skill $signal $confidence $reason)
   (progn (collapse (match &skills (CandidateSkillTrigger $skill $signal $oldconfidence $oldreason)
                           (remove-atom &skills (CandidateSkillTrigger $skill $signal $oldconfidence $oldreason))))
          (add-atom &skills (SkillTrigger $skill $signal $confidence $reason))
          (SkillTriggerPromoted $skill $signal $confidence $reason)))
