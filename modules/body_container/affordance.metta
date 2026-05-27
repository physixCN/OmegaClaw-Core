; Body-container affordance cards.

(SkillTopic "body-container-status" "body")
(SkillTopic "body-container-self" "body")
(SkillTopic "body-container-launcher" "body")
(SkillTopic "body-container-last-trace" "body")

(SkillCardLine "body-container-status" "body-container-status - observe the VM body the agent is running inside")
(SkillCardLine "body-container-self" "body-container-self - return body-container atoms for self/body reasoning")

(SkillTrigger "body-container-status" "mentions-word:body" 0.62 "body wording may need body-container status")
(SkillTrigger "body-container-status" "mentions-word:resource" 0.58 "resource wording may need body-container status")
(SkillTrigger "body-container-status" "mentions-word:process" 0.56 "process wording may need body-container status")

(Effect "body-container-self" "body-self-atoms")

; Skill-card hygiene: every callable signature has a visible card and argument shape.
(Skill "body-container-last-trace")
(Skill "body-container-launcher")
(Skill "body-container-self")
(Skill "body-container-status")
(SkillArg "body-container-status" 0 "none" "none")
(SkillArg "body-container-self" 0 "none" "none")
(SkillArg "body-container-launcher" 0 "none" "none")
(SkillCardLine "body-container-launcher" "body-container-launcher - body skill; inspect this card before use when syntax or purpose is uncertain")
(SkillArg "body-container-last-trace" 0 "none" "none")
(SkillCardLine "body-container-last-trace" "body-container-last-trace - body skill; inspect this card before use when syntax or purpose is uncertain")
