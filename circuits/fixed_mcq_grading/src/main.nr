global MAX_QUESTIONS: u32 = 32;

fn main(
    selected_choice_hashes: [Field; 32],
    correct_choice_hashes: [Field; 32],
    question_count: pub u32,
    points_per_question: pub u32,
    score: pub u32,
    max_score: pub u32,
) {
    let mut computed_score = 0;

    for i in 0..MAX_QUESTIONS {
        if i < question_count {
            if selected_choice_hashes[i] == correct_choice_hashes[i] {
                computed_score += points_per_question;
            }
        }
    }

    assert(computed_score == score);
    assert(max_score == question_count * points_per_question);
}
