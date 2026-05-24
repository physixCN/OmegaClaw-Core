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
