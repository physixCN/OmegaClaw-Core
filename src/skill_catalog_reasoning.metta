; Reasoning skill catalog declarations.
; Imported as SkillCatalog / SkillHelp atoms by the core loader.

(SkillCatalog "Reasoning: truth-expectation frequency confidence, test-metta sexpression, metta sexpression, nal-step premise1 premise2, pln-step premise1 premise2, nars-query kb term")
(SkillHelp "reasoning" "Reasoning affordances:")
(SkillHelp "reasoning" "truth-expectation frequency confidence")
(SkillHelp "reasoning" "belief-revision-candidate is documented under memory because it writes/reviews belief-space candidates")
(SkillHelp "reasoning" "test-metta sexpression before uncertain raw MeTTa")
(SkillHelp "reasoning" "metta sexpression - execute direct MeTTa expression")
(SkillHelp "reasoning" "nal-step premise1_expression premise2_expression - use NAL copulas such as -->, ==> and <->")
(SkillHelp "reasoning" "pln-step premise1_expression premise2_expression - use truth-valued PLN statements, e.g. ((Inheritance A B) (stv f c))")
(SkillHelp "reasoning" "For plain Inheritance transitivity, use pln-step with two truth-valued premises A->B and B->C. For NAL inheritance transitivity, write the relation as -->.")
(SkillHelp "reasoning" "nars-query kb_expression term_expression")
(SkillHelp "reasoning" "nars-derive tasks_expression beliefs_expression")
(SkillHelp "reasoning" "run-metta-file filepath - run a full .metta file through the standard runner")
