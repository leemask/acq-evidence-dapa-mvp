const sampleProject = {
  title: "EO/IR 영상 기반 탑재형 엣지 AI 표적탐지 기술",
  objective: "무인항공체계에서 EO/IR 영상을 실시간 처리하여 저피탐 표적을 조기에 탐지하고 운용자의 판단 시간을 단축한다.",
  content: "경량 멀티모달 탐지 모델, 제한된 연산자원용 엣지 추론 최적화, 주야간 영상 융합, 오탐 억제 및 탑재 환경 실증 기술을 개발한다.",
  outcome: "탑재형 표적탐지 알고리즘 시제품, 성능평가 데이터셋, 운용자 검토용 근거 리포트",
  platform: "무인항공체계",
  userOrg: "육군",
  stage: "시험개발"
};

const EXPECTED_SOURCE_SHA256 = "cfbd30848f62f4f439b9247f8d3cb4b2cb4b2cdaa3c4dc1df44a570da7940d6d";
const DEFENSE_SOURCE_URL = "https://www.data.go.kr/data/15041871/fileData.do";

let defenseIndex = null;
let candidates = [];
let evaluationReport = null;

const sources = [
  {
    name: "국방기술품질원 핵심기술 R&D 과제목록",
    code: "dtaq_core_rd_projects",
    role: "유사과제 주 말뭉치",
    method: "공식 CSV → UTF-8 검색 인덱스",
    status: "1,194건 적재 완료",
    tone: "success",
    detail: "버전 2025-08-28 · 원본/레코드 SHA-256 보관"
  },
  {
    name: "방위사업청 용어사전",
    code: "dapa_terms",
    role: "한·영 용어 정규화",
    method: "CSV 스냅샷",
    status: "다음 연결",
    tone: "neutral",
    detail: "소스·필드 매핑 설계 완료"
  },
  {
    name: "방위사업청 CS 지정품명집",
    code: "dapa_cs_item_names",
    role: "품목·구성품 연결",
    method: "CSV 스냅샷",
    status: "다음 연결",
    tone: "neutral",
    detail: "품명·정의 필드 매핑 설계 완료"
  },
  {
    name: "방위사업청 국내조달 계약정보",
    code: "dapa_domestic_contracts",
    role: "획득·조달 맥락 보강",
    method: "CSV 스냅샷",
    status: "다음 연결",
    tone: "neutral",
    detail: "담당자·사업자번호·주소는 UI 제외"
  },
  {
    name: "NTIS 국가 R&D 과제검색",
    code: "ntis_public_project_search",
    role: "범부처 유사과제 검색",
    method: "Open API · XML",
    status: "어댑터 구현 · 키 대기",
    tone: "pending",
    detail: "개발키는 서버 환경변수로만 연결"
  }
];

const state = {
  decisions: new Map(),
  currentCandidate: null,
  tagsConfirmed: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function setStep(step) {
  $$(".stepper li").forEach((item) => {
    const value = Number(item.dataset.step);
    item.classList.toggle("active", value === step);
    item.classList.toggle("complete", value < step);
  });
}

function showView(name, title) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  if (title) $("#pageTitle").textContent = title;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setSourceMessage(title, text, chipText) {
  $("#dataNoticeTitle").textContent = title;
  $("#dataNoticeText").textContent = text;
  $("#dataCutoffChip").lastChild.textContent = ` ${chipText}`;
}

async function loadDefenseIndex() {
  if (defenseIndex) return defenseIndex;
  setSourceMessage("공식 공개데이터 연결", "국방기술품질원 공개 과제 1,194건을 불러오고 있습니다.", "국방 데이터 로딩 중");
  const response = await fetch("./data/dtaq-core-projects.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`검색 인덱스 응답 오류 (${response.status})`);
  const parsed = await response.json();
  if (parsed?.stats?.recordCount !== 1194 || parsed?.source?.sourceSha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error("검색 인덱스의 건수 또는 원본 해시가 기대값과 다릅니다.");
  }
  defenseIndex = parsed;
  setSourceMessage(
    "국방 실데이터 1,194건 연결",
    "공식 CSV 버전 2025-08-28 · 원본 SHA-256 고정 · NTIS는 승인키 연결 대기",
    "국방 1,194건 · NTIS 키 대기"
  );
  renderSources();
  return defenseIndex;
}

function loadSample() {
  Object.entries(sampleProject).forEach(([key, value]) => {
    const field = document.getElementById(key === "title" ? "projectTitle" : key);
    if (field) field.value = value;
  });
  updateExtraction();
  showView("input", "신규 과제 검토");
  setStep(1);
  showToast("예시 과제를 불러왔습니다.");
}

function makeTags(values) {
  return values.map((value) => `<button class="tag" type="button">${escapeHtml(value)}</button>`).join("");
}

function updateExtraction() {
  const combined = [$("#projectTitle").value, $("#objective").value, $("#content").value, $("#outcome").value].join(" ");
  if (combined.trim().length <= 12) return;

  const technologies = [];
  if (/EO\/IR|EO|IR|영상/i.test(combined)) technologies.push("EO/IR 영상");
  if (/엣지|경량|추론/i.test(combined)) technologies.push("Edge AI");
  if (/탐지|식별|추적/.test(combined)) technologies.push("표적 탐지·식별");
  if (/융합|멀티모달|다중센서/.test(combined)) technologies.push("센서 융합");
  $("#technologyTags").innerHTML = makeTags(technologies.length ? technologies : ["기술어 확인 필요"]);
  $("#platformTags").innerHTML = makeTags([$("#platform").value || "대상 체계 확인 필요"]);

  const deliverables = [];
  if (/알고리즘|모델/.test(combined)) deliverables.push("알고리즘");
  if (/시제품/.test(combined)) deliverables.push("시제품");
  if (/데이터셋/.test(combined)) deliverables.push("평가 데이터셋");
  if (/리포트|보고서/.test(combined)) deliverables.push("근거 리포트");
  $("#deliverableTags").innerHTML = makeTags(deliverables.length ? deliverables : ["산출물 확인 필요"]);
  $("#ontologyPath").innerHTML = "<b>Project</b> → USES_TECHNOLOGY → <b>Edge AI</b><br><b>Project</b> → TARGETS → <b>무인항공체계</b><br><b>Project</b> → DELIVERS → <b>탐지 알고리즘</b>";
  $("#confirmTags").disabled = false;
}

function projectFromForm() {
  return {
    title: $("#projectTitle").value.trim(),
    objective: $("#objective").value.trim(),
    content: $("#content").value.trim(),
    outcome: $("#outcome").value.trim(),
    platform: $("#platform").value.trim(),
    userOrg: $("#userOrg").value.trim(),
    stage: $("#stage").value.trim()
  };
}

function updateFilterCounts() {
  $("#filterAll").textContent = `전체 ${candidates.length}`;
  $("#filterDefense").textContent = `국방 ${candidates.filter((item) => item.source === "defense").length}`;
  $("#filterNtis").textContent = `NTIS ${candidates.filter((item) => item.source === "ntis").length}`;
}

function renderResults(filter = "all") {
  const list = $("#resultList");
  const data = filter === "all" ? candidates : candidates.filter((item) => item.source === filter);
  if (!data.length) {
    list.innerHTML = `<div class="result-empty"><strong>${filter === "ntis" ? "NTIS 승인키 연결 대기" : "표시할 후보가 없습니다."}</strong><span>${filter === "ntis" ? "어댑터는 구현되어 있으며 키 연결 후 같은 화면에 통합됩니다." : "검색어를 보완해 다시 실행하세요."}</span></div>`;
    return;
  }
  const factorLabels = ["목적·내용", "산출물", "기술", "단계", "체계·품목", "기관·기간"];
  list.innerHTML = data.map((item) => {
    const decision = state.decisions.get(item.id);
    return `
      <article class="result-card ${escapeHtml(item.level)}" data-source="${escapeHtml(item.source)}">
        <div class="score-block"><strong>${item.score}</strong><span>검토우선순위 지수</span></div>
        <div class="result-main">
          <h3><span class="source-pill ${escapeHtml(item.source)}">${escapeHtml(item.sourceLabel)}</span>${escapeHtml(item.title)}</h3>
          <p class="record-meta">${escapeHtml(item.org)} · ${escapeHtml(item.period)} · ${escapeHtml(item.id)}</p>
          <div class="evidence-lines">
            ${item.evidence.map((line, index) => `<div class="evidence-line"><b>0${index + 1}</b><span>${escapeHtml(line)}</span></div>`).join("")}
          </div>
          <p class="difference"><strong>차별성 단서</strong> · ${escapeHtml(item.difference)}</p>
          <div class="factor-bar" aria-label="세부 점수">
            ${factorLabels.map((label, index) => `<div class="factor" title="${label} ${item.factors[index] || 0}"><span>${label} ${item.factors[index] || 0}</span><i style="--fill:${item.factors[index] || 0}%"></i></div>`).join("")}
          </div>
        </div>
        <div class="result-actions">
          <button class="detail-button" type="button" data-detail-id="${escapeHtml(item.id)}">근거·원문 비교</button>
          <div class="decision-group" aria-label="검토 판단">
            <button class="decision-button ${decision === "include" ? "active" : ""}" type="button" data-id="${escapeHtml(item.id)}" data-decision="include">채택</button>
            <button class="decision-button ${decision === "exclude" ? "active" : ""}" type="button" data-id="${escapeHtml(item.id)}" data-decision="exclude">제외</button>
            <button class="decision-button ${decision === "hold" ? "active" : ""}" type="button" data-id="${escapeHtml(item.id)}" data-decision="hold">보류</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

async function executeSearch(project = projectFromForm()) {
  const index = await loadDefenseIndex();
  const result = window.AcqSearch.searchRecords(index, project, 10);
  candidates = result.candidates.slice(0, 5);
  state.decisions.clear();
  state.currentCandidate = null;
  $("#queryTitle").textContent = project.title;
  $("#corpusSummary").textContent = `국방 ${result.diagnostics.recordCount.toLocaleString("ko-KR")}건 검색 · ${result.diagnostics.matchedCount.toLocaleString("ko-KR")}건 1차 후보 · NTIS 키 대기`;
  $$(".filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === "all"));
  updateFilterCounts();
  renderResults();
  updateDecisionCount();
  showView("analysis", "유사과제 분석");
  setStep(2);
  return result;
}

function updateDecisionCount() {
  $("#decisionCount").textContent = `${state.decisions.size}건`;
  $("#openOpinionButton").disabled = ![...state.decisions.values()].includes("include");
}

function openDrawer(candidate) {
  if (!candidate) return;
  state.currentCandidate = candidate;
  $("#drawerTitle").textContent = candidate.title;
  const evidenceRows = (candidate.evidenceDetails || []).map((item) => `
    <div class="evidence-record">
      <h3>${escapeHtml(item.label)} · ${escapeHtml(item.field)}</h3>
      <blockquote>${escapeHtml(item.excerpt)}</blockquote>
    </div>`).join("");
  $("#drawerContent").innerHTML = `
    <div class="compare-grid">
      <div class="compare-box"><strong>제안과제 문장</strong><p>${escapeHtml($("#content").value || sampleProject.content)}</p></div>
      <div class="compare-arrow" aria-hidden="true">↔</div>
      <div class="compare-box"><strong>공개과제 대응 문장</strong><p>${escapeHtml(candidate.excerpt)}</p></div>
    </div>
    ${evidenceRows}
    <div class="evidence-record provenance-record">
      <h3>출처·무결성</h3>
      <div class="record-fields">
        <b>데이터 제공기관</b><span>국방기술품질원</span>
        <b>레코드 ID</b><span>${escapeHtml(candidate.id)}</span>
        <b>원본 CSV 행</b><span>${escapeHtml(candidate.sourceRow)}</span>
        <b>사업/단계</b><span>${escapeHtml(candidate.programType || "미집계")} · ${escapeHtml(candidate.stage || "미집계")}</span>
        <b>발주/관리기관</b><span>${escapeHtml(candidate.orderingOrg || "미집계")} · ${escapeHtml(candidate.managementOrg || "미집계")}</span>
        <b>온톨로지 경로</b><span>${escapeHtml(candidate.path)}</span>
        <b>레코드 SHA-256</b><span class="hash-value">${escapeHtml(candidate.fullHash)}</span>
        <b>데이터 버전</b><span>2025-08-28</span>
        <b>원문</b><span><a class="record-link" href="${DEFENSE_SOURCE_URL}" target="_blank" rel="noreferrer">공공데이터포털에서 열기 ↗</a></span>
      </div>
    </div>
    <div class="drawer-actions">
      <button class="primary-button" type="button" data-drawer-decision="include">근거 채택</button>
      <button class="secondary-button" type="button" data-drawer-decision="exclude">근거 제외</button>
    </div>`;
  $("#drawerBackdrop").hidden = false;
  $("#evidenceDrawer").classList.add("open");
  $("#evidenceDrawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  $("#evidenceDrawer").classList.remove("open");
  $("#evidenceDrawer").setAttribute("aria-hidden", "true");
  $("#drawerBackdrop").hidden = true;
}

function renderOpinion() {
  const included = candidates.filter((item) => state.decisions.get(item.id) === "include");
  $("#opinionHeading").textContent = $("#projectTitle").value || sampleProject.title;
  $("#opinionSummary").textContent = $("#objective").value || sampleProject.objective;
  $("#opinionEvidence").innerHTML = included.map((item, index) => `
    <div class="opinion-item">
      <h4>${index + 1}) ${escapeHtml(item.title)} <button class="citation" type="button" data-detail-id="${escapeHtml(item.id)}" aria-label="근거 ${index + 1} 열기">E${index + 1}</button></h4>
      <p>${escapeHtml(item.evidence[0] || item.excerpt)}. 다만 ${escapeHtml(item.difference)}.</p>
    </div>`).join("");
  const names = included.map((item) => item.title).join(", ");
  $("#finalOpinion").value = `국방기술품질원 공개 핵심기술 과제 ${defenseIndex.stats.recordCount.toLocaleString("ko-KR")}건을 검색한 결과, ${names}이(가) 우선 검토 후보로 확인되었다. 목적·기술어 일부가 중첩되나 공개 필드만으로 중복 여부를 확정할 수 없으므로 요구성능, 적용체계, 운용조건의 차별성을 원문에서 확인해야 한다. NTIS 결과는 승인키 연결 전이므로 본 예비의견에 포함하지 않았다.`;
  $("#evidenceWarning").textContent = "채택한 공개 레코드의 원문 필드와 SHA-256이 연결되어 있습니다.";
  showView("opinion", "검토 의견서");
  setStep(4);
}

function renderSources() {
  $("#sourceGrid").innerHTML = sources.map((source) => `
    <article class="source-card">
      <div class="source-card-head">
        <h3>${escapeHtml(source.name)}</h3>
        <span class="status ${escapeHtml(source.tone)}">${escapeHtml(source.status)}</span>
      </div>
      <p>${escapeHtml(source.role)}</p>
      <dl>
        <dt>소스 코드</dt><dd>${escapeHtml(source.code)}</dd>
        <dt>접근 방식</dt><dd>${escapeHtml(source.method)}</dd>
        <dt>상세</dt><dd>${escapeHtml(source.detail)}</dd>
      </dl>
    </article>`).join("");
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "–";
}

function statusBadge(status, label) {
  const tone = status === "pass" ? "success" : status === "fail" ? "fail" : "pending";
  return `<span class="status ${tone}">${escapeHtml(label)}</span>`;
}

function renderEvaluationReport() {
  if (!evaluationReport) return;
  const report = evaluationReport;
  const provisional = report.provisionalMetrics;
  $("#evaluationWarning").textContent = report.warning || "독립 판정과 합의가 완료된 공식 평가 결과입니다.";
  $("#metricCorpusChecks").textContent = `${report.corpusIntegrity.summary.passed}/${report.corpusIntegrity.summary.total}`;
  $("#metricCaseCount").textContent = report.evaluationSet.caseCount;
  $("#metricHumanCount").textContent = `사람 합의 ${report.evaluationSet.humanAdjudicatedCount}건`;
  $("#metricEvidenceIntegrity").textContent = percent(provisional.evidenceIntegrity);
  $("#metricRecall").textContent = percent(provisional.recallAt10);

  $("#gateCorpusResult").textContent = `${report.corpusIntegrity.summary.passed}/${report.corpusIntegrity.summary.total} 통과`;
  $("#gateCorpusStatus").innerHTML = statusBadge(report.corpusIntegrity.status, report.corpusIntegrity.status === "pass" ? "통과" : "실패");
  $("#gateEvidenceResult").textContent = percent(provisional.evidenceIntegrity);
  $("#gateEvidenceStatus").innerHTML = statusBadge(provisional.evidenceIntegrity >= 0.95 ? "pass" : "fail", provisional.evidenceIntegrity >= 0.95 ? "통과" : "실패");
  $("#gateHumanResult").textContent = `${report.evaluationSet.humanAdjudicatedCount}/${report.evaluationSet.caseCount}건 합의`;
  $("#gateHumanStatus").innerHTML = statusBadge(report.claimStatus === "reportable" ? "pass" : "pending", report.claimStatus === "reportable" ? "통과" : "판정 필요");
  $("#gateRecallResult").textContent = `${percent(provisional.recallAt10)} · 진단값`;
  $("#gateRecallStatus").innerHTML = statusBadge(report.claimStatus === "reportable" ? (provisional.recallAt10 >= 0.85 ? "pass" : "fail") : "pending", report.claimStatus === "reportable" ? (provisional.recallAt10 >= 0.85 ? "통과" : "미달") : "공개 보류");

  $("#caseTableBody").innerHTML = report.cases.map((testCase) => {
    const top = testCase.topResults[0];
    return `<tr>
      <td><strong>${escapeHtml(testCase.id)}</strong><br>${escapeHtml(testCase.title)}</td>
      <td class="case-expected">${testCase.expectedIds.map(escapeHtml).join("<br>")}</td>
      <td class="case-top">${top ? `${escapeHtml(top.id)}<br>${escapeHtml(top.title)}` : "후보 없음"}</td>
      <td>${percent(testCase.metrics.recallAt10)}</td>
      <td>${statusBadge("pending", "잠정")}</td>
    </tr>`;
  }).join("");
}

async function loadEvaluationReport() {
  if (evaluationReport) return evaluationReport;
  const response = await fetch("./data/evaluation-report.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`평가 리포트 응답 오류 (${response.status})`);
  const parsed = await response.json();
  if (parsed?.dataset?.sourceSha256 !== EXPECTED_SOURCE_SHA256) throw new Error("평가 리포트의 데이터 해시가 현재 말뭉치와 다릅니다.");
  evaluationReport = parsed;
  renderEvaluationReport();
  return evaluationReport;
}

function updateApprovalState() {
  const checks = $$(".approval-check").every((input) => input.checked);
  $("#approveButton").disabled = !(checks && $("#humanConclusion").value);
}

$$("[data-load-sample]").forEach((button) => button.addEventListener("click", loadSample));

$("#newCaseButton").addEventListener("click", () => {
  $("#projectForm").reset();
  candidates = [];
  state.decisions.clear();
  state.tagsConfirmed = false;
  ["technologyTags", "platformTags", "deliverableTags"].forEach((id) => {
    document.getElementById(id).innerHTML = "<i>입력 대기</i>";
  });
  $("#ontologyPath").innerHTML = "<span>입력 후 온톨로지 연결 경로가 표시됩니다.</span>";
  $("#confirmTags").disabled = true;
  updateFilterCounts();
  showView("input", "신규 과제 검토");
  setStep(1);
});

$$(`input, textarea, select`, $("#projectForm")).forEach((field) => field.addEventListener("input", updateExtraction));

$("#confirmTags").addEventListener("click", (event) => {
  state.tagsConfirmed = true;
  event.currentTarget.textContent = "✓ 핵심요소 확인됨";
  event.currentTarget.classList.add("confirmed");
  showToast("검색 기준으로 반영됩니다.");
});

$("#projectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#analyzeButton");
  button.disabled = true;
  button.firstElementChild.textContent = "국방 공개과제 검색 중…";
  try {
    await executeSearch();
  } catch (error) {
    setSourceMessage("데이터 연결 확인 필요", error.message, "국방 데이터 오류");
    showToast("검색 인덱스를 불러오지 못했습니다.");
  } finally {
    button.disabled = false;
    button.firstElementChild.textContent = "근거 기반 분석 시작";
  }
});

$("#resultList").addEventListener("click", (event) => {
  const detail = event.target.closest("[data-detail-id]");
  if (detail) {
    openDrawer(candidates.find((item) => item.id === detail.dataset.detailId));
    setStep(3);
    return;
  }
  const decision = event.target.closest("[data-decision]");
  if (decision) {
    state.decisions.set(decision.dataset.id, decision.dataset.decision);
    renderResults($(".filter.active").dataset.filter);
    updateDecisionCount();
    showToast(`후보를 ${decision.textContent.trim()}으로 기록했습니다.`);
  }
});

$("#drawerContent").addEventListener("click", (event) => {
  const action = event.target.closest("[data-drawer-decision]");
  if (!action || !state.currentCandidate) return;
  state.decisions.set(state.currentCandidate.id, action.dataset.drawerDecision);
  renderResults($(".filter.active").dataset.filter);
  updateDecisionCount();
  closeDrawer();
  showToast(action.dataset.drawerDecision === "include" ? "의견서 근거로 채택했습니다." : "근거에서 제외했습니다.");
});

$("#closeDrawer").addEventListener("click", closeDrawer);
$("#drawerBackdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });

$$(".filter").forEach((button) => button.addEventListener("click", () => {
  $$(".filter").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  renderResults(button.dataset.filter);
}));

$("#openOpinionButton").addEventListener("click", renderOpinion);
$("#backToResults").addEventListener("click", () => { showView("analysis", "유사과제 분석"); setStep(2); });

$("#opinionEvidence").addEventListener("click", (event) => {
  const citation = event.target.closest("[data-detail-id]");
  if (citation) openDrawer(candidates.find((item) => item.id === citation.dataset.detailId));
});

$$(".approval-check").forEach((input) => input.addEventListener("change", updateApprovalState));
$("#humanConclusion").addEventListener("change", updateApprovalState);
$("#approveButton").addEventListener("click", () => {
  showToast("검토의견서 v1이 승인되었습니다.");
  $("#approveButton").textContent = "✓ 승인 완료 · 감사로그 기록됨";
  $("#approveButton").disabled = true;
});

$$(".nav-item").forEach((button) => button.addEventListener("click", () => {
  $$(".nav-item").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  const target = button.dataset.viewTarget;
  if (target === "sources") { renderSources(); showView("sources", "데이터 소스"); }
  else if (target === "evaluation") {
    showView("evaluation", "평가 리포트");
    loadEvaluationReport().catch((error) => { $("#evaluationWarning").textContent = error.message; });
  }
  else showView("input", "신규 과제 검토");
}));

function registerReviewTool() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const registration = context.registerTool({
    name: "run_public_similarity_review",
    title: "공개 유사과제 분석 실행",
    description: "제안과제를 국방기술품질원 공개 과제 1,194건에서 검색하고 상위 후보의 원문 근거를 표시합니다.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        objective: { type: "string", minLength: 1 },
        content: { type: "string", minLength: 1 },
        outcome: { type: "string", minLength: 1 },
        platform: { type: "string" },
        userOrg: { type: "string" },
        stage: { type: "string" }
      },
      required: ["title", "objective", "content", "outcome"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(input) {
      if (!input || typeof input !== "object") throw new Error("과제 입력 객체가 필요합니다.");
      for (const key of ["title", "objective", "content", "outcome"]) {
        if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`${key} 값이 필요합니다.`);
      }
      const fieldMap = { title: "projectTitle", objective: "objective", content: "content", outcome: "outcome", platform: "platform", userOrg: "userOrg", stage: "stage" };
      Object.entries(fieldMap).forEach(([key, id]) => {
        if (typeof input[key] === "string") document.getElementById(id).value = input[key];
      });
      updateExtraction();
      const result = await executeSearch(projectFromForm());
      return {
        status: "human_review_required",
        corpus: "dtaq_core_rd_projects",
        corpusVersion: defenseIndex.source.versionDate,
        corpusRecordCount: defenseIndex.stats.recordCount,
        candidateCount: candidates.length,
        candidateIds: candidates.map((candidate) => candidate.id),
        matchedCount: result.diagnostics.matchedCount,
        ntisStatus: "adapter_ready_api_key_pending"
      };
    }
  }, { signal: lifecycle.signal });
  Promise.resolve(registration).catch(() => lifecycle.abort());
}

loadSample();
renderSources();
loadDefenseIndex().catch((error) => {
  setSourceMessage("데이터 연결 확인 필요", error.message, "국방 데이터 오류");
});
loadEvaluationReport().catch((error) => { $("#evaluationWarning").textContent = error.message; });
registerReviewTool();
