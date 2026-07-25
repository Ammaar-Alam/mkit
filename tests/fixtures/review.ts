export const REVIEW_SENTINELS = {
  question: "MKIT_QUESTION_TEXT_6B8C",
  passage: "MKIT_PASSAGE_TEXT_D06F",
  choiceA: "MKIT_CHOICE_A_938D",
  choiceB: "MKIT_CHOICE_B_A881",
  choiceC: "MKIT_CHOICE_C_0B23",
  choiceD: "MKIT_CHOICE_D_151E",
  statusText: "MKIT_STATUS_INCORRECT_6A5E",
  statusTitle: "MKIT_STATUS_TITLE_INCORRECT_93AB",
  statusAria: "MKIT_STATUS_LABEL_INCORRECT_C163",
  navigatorText: "MKIT_NAV_ICON_CHECK_9CF2",
  navigatorTitle: "MKIT_NAV_TITLE_CORRECT_44BD",
  navigatorAria: "MKIT_NAV_LABEL_CORRECT_571A",
  explanation: "MKIT_EXPLANATION_BODY_824C",
  correctMarker: "MKIT_CORRECT_ANSWER_B_71ED",
  correctTitle: "MKIT_CORRECT_TITLE_B_562C",
  correctAria: "MKIT_CORRECT_LABEL_B_307A",
  originalMarker: "MKIT_ORIGINAL_ANSWER_A_75FC",
  originalTitle: "MKIT_ORIGINAL_TITLE_SELECTED_927F",
  originalAria: "MKIT_ORIGINAL_LABEL_SELECTED_INCORRECT_930E",
  metadataTime: "MKIT_TIME_07_42_88B0",
  metadataDifficulty: "MKIT_DIFFICULTY_HARD_D79B",
  tally: "MKIT_TALLY_12_OF_59_A10C",
  sectionStatus: "MKIT_SECTION_RESULT_8_CORRECT_C2A4",
  tooltip: "MKIT_TOOLTIP_BODY_CORRECT_9A85",
  tooltipTitle: "MKIT_TOOLTIP_TITLE_CORRECT_053A",
  resultRail: "MKIT_RESULT_RAIL_OLD_ATTEMPT_074D",
  scoreTotal: "MKIT_SCORE_500_2F19",
  scoreCp: "MKIT_SCORE_CP_125_D742",
  scoreCars: "MKIT_SCORE_CARS_125_3E4A",
  scoreTitle: "MKIT_SCORE_TITLE_500_0B77",
  scoreAria: "MKIT_SCORE_SUMMARY_LABEL_892A",
  account: "MKIT_ACCOUNT_3F8E",
  token: "MKIT_TOKEN_E0D4",
  screenshot: "data:image/png;base64,MKIT_SCREENSHOT_C301",
} as const;

export const FORBIDDEN_SERIALIZED_SENTINELS = Object.values(REVIEW_SENTINELS);

export function mountCompleteReviewFixture(): HTMLElement {
  document.body.innerHTML = `
    <main
      id="exam-review-shell"
      data-page-kind="full-length-review"
      data-exam-id="synthetic-fl-1"
    >
      <header id="review-header">
        <span class="question-tally">${REVIEW_SENTINELS.tally}</span>
        <span class="section-status">${REVIEW_SENTINELS.sectionStatus}</span>
      </header>

      <nav id="question-navigator" aria-label="Question navigator">
        <button
          id="nav-q1"
          class="navigator-item is-correct"
          title="${REVIEW_SENTINELS.navigatorTitle}"
          aria-label="${REVIEW_SENTINELS.navigatorAria}"
        >
          <span>1</span>
          <span class="correctness-icon">${REVIEW_SENTINELS.navigatorText}</span>
        </button>
        <button id="nav-q2" class="navigator-item is-incorrect">
          <span>2</span>
        </button>
      </nav>

      <section
        id="question-q1"
        data-question-id="synthetic-cp-001"
        data-section-id="cp"
        data-category-code="1A"
        data-question-kind="passage"
        data-correct-choice="B"
      >
        <p id="question-copy">${REVIEW_SENTINELS.question}</p>
        <div id="passage-copy">${REVIEW_SENTINELS.passage}</div>

        <div
          id="question-status"
          class="review-status is-incorrect"
          title="${REVIEW_SENTINELS.statusTitle}"
          aria-label="${REVIEW_SENTINELS.statusAria}"
          style="border: 8px solid red; background: pink"
        >
          ${REVIEW_SENTINELS.statusText}
        </div>

        <ol id="official-answer-list">
          <li
            id="choice-a"
            class="answer-choice was-selected is-incorrect was-highlighted"
            title="${REVIEW_SENTINELS.originalTitle}"
            aria-label="${REVIEW_SENTINELS.originalAria}"
            style="border: 4px solid red"
          >
            <input id="official-a" type="radio" name="official-answer" checked>
            <label for="official-a">
              <span class="choice-letter">A</span>
              <span class="choice-copy">${REVIEW_SENTINELS.choiceA}</span>
              <span class="original-marker">${REVIEW_SENTINELS.originalMarker}</span>
            </label>
          </li>
          <li
            id="choice-b"
            class="answer-choice is-correct-answer was-eliminated"
            title="${REVIEW_SENTINELS.correctTitle}"
            aria-label="${REVIEW_SENTINELS.correctAria}"
            style="border: 4px solid green"
          >
            <input id="official-b" type="radio" name="official-answer">
            <label for="official-b">
              <span class="choice-letter">B</span>
              <span class="choice-copy">${REVIEW_SENTINELS.choiceB}</span>
              <span class="correct-marker">${REVIEW_SENTINELS.correctMarker}</span>
            </label>
          </li>
          <li id="choice-c" class="answer-choice">
            <input id="official-c" type="radio" name="official-answer">
            <label for="official-c">
              <span class="choice-letter">C</span>
              <span class="choice-copy">${REVIEW_SENTINELS.choiceC}</span>
            </label>
          </li>
          <li id="choice-d" class="answer-choice">
            <input id="official-d" type="radio" name="official-answer">
            <label for="official-d">
              <span class="choice-letter">D</span>
              <span class="choice-copy">${REVIEW_SENTINELS.choiceD}</span>
            </label>
          </li>
        </ol>

        <section id="official-solution">
          <h2>Solution</h2>
          <p>${REVIEW_SENTINELS.explanation}</p>
        </section>

        <dl id="official-metadata">
          <dt>Time</dt><dd>${REVIEW_SENTINELS.metadataTime}</dd>
          <dt>Difficulty</dt><dd>${REVIEW_SENTINELS.metadataDifficulty}</dd>
        </dl>

        <button
          id="tooltip-trigger"
          title="${REVIEW_SENTINELS.tooltipTitle}"
          aria-describedby="spoiler-tooltip"
        >
          Details
        </button>
        <div id="spoiler-tooltip" role="tooltip" data-review-result="correct">
          ${REVIEW_SENTINELS.tooltip}
        </div>
      </section>

      <aside id="official-results-rail">${REVIEW_SENTINELS.resultRail}</aside>

      <footer>
        <button id="native-previous">Previous</button>
        <button id="native-next">Next</button>
        <button id="native-submit">Submit</button>
        <button id="native-reset">Reset</button>
      </footer>
    </main>
  `;
  return requiredElement<HTMLElement>("#exam-review-shell");
}

export function mountScoreReportFixture(): HTMLElement {
  document.body.innerHTML = `
    <main
      id="score-report"
      data-page-kind="score-report"
      data-exam-id="synthetic-fl-1"
    >
      <section
        id="score-summary"
        title="${REVIEW_SENTINELS.scoreTitle}"
        aria-label="${REVIEW_SENTINELS.scoreAria}"
      >
        <span id="total-score">${REVIEW_SENTINELS.scoreTotal}</span>
        <span class="section-score" data-section="cp">${REVIEW_SENTINELS.scoreCp}</span>
        <span class="section-score" data-section="cars">${REVIEW_SENTINELS.scoreCars}</span>
      </section>
      <a id="review-all" href="/synthetic/review">Review all</a>
    </main>
  `;
  return requiredElement<HTMLElement>("#score-report");
}

export function mountConfirmedAnchorScoreFixture(): HTMLElement {
  document.body.innerHTML = `
    <main class="score-reports-wrapper" data-exam-id="synthetic-confirmed-exam">
      <section class="results-contents">
        <span class="scaled-score">${REVIEW_SENTINELS.scoreTotal}</span>
        <span class="questions-correct">${REVIEW_SENTINELS.scoreCp}</span>
        <span class="questions-answered">${REVIEW_SENTINELS.scoreCars}</span>
      </section>
      <button id="review-all" type="button">Review all</button>
    </main>
  `;
  return requiredElement<HTMLElement>(".score-reports-wrapper");
}

export function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Synthetic fixture is missing ${selector}.`);
  }
  return element as T;
}
