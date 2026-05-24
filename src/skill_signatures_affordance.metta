; Skill affordance command syntax declarations.
;
; These expose a small symbolic directory for what skill fits a situation
; without hiding routing decisions in Python.

(SkillSignature query-skill-space (Arg text topic))
(SkillSignature choose-skill-for (Arg rest-text situation))
(SkillSignature explain-skill (Arg text skill))
(SkillSignature skill-card (Arg text skill))
