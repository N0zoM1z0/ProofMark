global MAX_PARTS: u32 = 16;
global MAX_MARKS_PER_PART: u32 = 5;
global TOTAL_MARK_SLOTS: u32 = 80;

fn main(
    scores_scaled: [u32; 80],
    mark_counts: [u32; 16],
    part_max_scores_scaled: [u32; 16],
    part_scores_scaled: [u32; 16],
    part_count: pub u32,
    markers_per_part: pub u32,
    adjudication_delta_scaled: pub u32,
    subjective_score_scaled: pub u32,
    subjective_max_score_scaled: pub u32,
) {
    assert(part_count <= MAX_PARTS);
    assert(markers_per_part > 0);
    assert(markers_per_part <= MAX_MARKS_PER_PART);

    let mut computed_subjective_score = 0;
    let mut computed_subjective_max_score = 0;

    for part_index in 0..MAX_PARTS {
        if part_index < part_count {
            let mark_count = mark_counts[part_index];
            let max_score = part_max_scores_scaled[part_index];

            assert(mark_count >= markers_per_part);
            assert(mark_count <= MAX_MARKS_PER_PART);

            let first_score = scores_scaled[part_index * MAX_MARKS_PER_PART];
            let mut min_baseline_score = first_score;
            let mut max_baseline_score = first_score;
            let mut baseline_sum = 0;
            let mut total_sum = 0;

            for mark_index in 0..MAX_MARKS_PER_PART {
                let score = scores_scaled[part_index * MAX_MARKS_PER_PART + mark_index];

                if mark_index < mark_count {
                    assert(score <= max_score);
                    total_sum += score;
                }

                if mark_index < markers_per_part {
                    baseline_sum += score;

                    if score < min_baseline_score {
                        min_baseline_score = score;
                    }

                    if score > max_baseline_score {
                        max_baseline_score = score;
                    }
                }
            }

            let baseline_delta = max_baseline_score - min_baseline_score;
            let expected_part_score = if baseline_delta > adjudication_delta_scaled {
                assert(mark_count > markers_per_part);
                (total_sum + (mark_count / 2)) / mark_count
            } else {
                (baseline_sum + (markers_per_part / 2)) / markers_per_part
            };

            assert(part_scores_scaled[part_index] == expected_part_score);
            computed_subjective_score += expected_part_score;
            computed_subjective_max_score += max_score;
        } else {
            assert(mark_counts[part_index] == 0);
            assert(part_max_scores_scaled[part_index] == 0);
            assert(part_scores_scaled[part_index] == 0);
        }
    }

    for mark_slot in 0..TOTAL_MARK_SLOTS {
        let part_index = mark_slot / MAX_MARKS_PER_PART;
        let mark_index = mark_slot % MAX_MARKS_PER_PART;

        if part_index >= part_count {
            assert(scores_scaled[mark_slot] == 0);
        } else if mark_index >= mark_counts[part_index] {
            assert(scores_scaled[mark_slot] == 0);
        }
    }

    assert(computed_subjective_score == subjective_score_scaled);
    assert(computed_subjective_max_score == subjective_max_score_scaled);
}
