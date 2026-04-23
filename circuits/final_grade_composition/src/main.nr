fn main(
    objective_score_scaled: pub u32,
    subjective_score_scaled: pub u32,
    final_score_scaled: pub u32,
    objective_max_score_scaled: pub u32,
    subjective_max_score_scaled: pub u32,
    max_score_scaled: pub u32,
) {
    assert(final_score_scaled == objective_score_scaled + subjective_score_scaled);
    assert(max_score_scaled == objective_max_score_scaled + subjective_max_score_scaled);
}
