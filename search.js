(function attachAcqSearch(globalScope) {
  const STOP_WORDS = new Set([
    "그리고", "대한", "위한", "통한", "기반", "활용", "적용", "기술", "개발", "연구", "과제",
    "한다", "하여", "있는", "위해", "에서", "으로", "및", "또는", "관련", "확보", "수행", "결과"
  ]);

  const DOMAIN_GROUPS = [
    { key: "ai", label: "인공지능", weight: 2, terms: ["인공지능", "딥러닝", "머신러닝", "ai", "지능형", "신경망"] },
    { key: "image", label: "EO/IR 영상", weight: 1.5, terms: ["eo/ir", "eo", "ir", "sar", "적외선", "열영상", "영상", "탐색기"] },
    { key: "target", label: "표적 탐지·식별", weight: 2.5, terms: ["표적", "탐지", "식별", "추적", "사물인식", "인식"] },
    { key: "edge", label: "탑재형 엣지처리", weight: 1.5, terms: ["엣지", "온보드", "탑재", "경량", "실시간", "edge", "onboard"] },
    { key: "unmanned", label: "무인체계", weight: 1, terms: ["무인기", "무인항공", "무인전투기", "무인이동체", "uav", "드론"] },
    { key: "sensor", label: "센서·레이다", weight: 1, terms: ["센서", "레이더", "레이다", "sar", "aesa", "광학"] },
    { key: "fusion", label: "다중센서 융합", weight: 0.5, terms: ["융합", "다중센서", "다중대역", "멀티모달", "복합센서"] }
  ];

  const DELIVERABLE_TERMS = [
    "알고리즘", "모델", "시제품", "시작품", "플랫폼", "데이터셋", "센서", "체계", "소프트웨어", "장치", "모듈"
  ];

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/<[^>]*>/g, " ")
      .replace(/[^0-9a-z가-힣/+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(value) {
    return [...new Set(normalize(value)
      .split(" ")
      .map((token) => token.replace(/(으로|에서|에게|까지|부터|하는|위한|기반|하여|하고|한다|해서|이며|이다|들을|으로써|을|를|은|는|이|가|의|에|와|과|도|만)$/g, ""))
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)))];
  }

  function includesTerm(haystack, term) {
    if (!term) return false;
    const normalizedTerm = normalize(term);
    if (/^[0-9a-z/+]+$/.test(normalizedTerm)) {
      return haystack.split(" ").some((token) => token === normalizedTerm || token.split("/").includes(normalizedTerm));
    }
    return haystack.includes(normalizedTerm) || haystack.replace(/\s/g, "").includes(normalizedTerm.replace(/\s/g, ""));
  }

  function weightedCoverage(weightedTerms, haystack) {
    const total = weightedTerms.reduce((sum, item) => sum + item.weight, 0);
    if (!total) return 0;
    const hit = weightedTerms.reduce((sum, item) => sum + (includesTerm(haystack, item.term) ? item.weight : 0), 0);
    return Math.min(1, hit / total);
  }

  function termSet(value, weight) {
    return tokenize(value).map((term) => ({ term, weight }));
  }

  function buildSignals(project) {
    const weighted = [
      ...termSet(project.title, 2.2),
      ...termSet(project.platform, 1.8),
      ...termSet(project.objective, 1.1),
      ...termSet(project.content, 1),
      ...termSet(project.outcome, 1.1)
    ];
    const merged = new Map();
    for (const item of weighted) merged.set(item.term, Math.max(item.weight, merged.get(item.term) || 0));
    const queryText = normalize([project.title, project.objective, project.content, project.outcome, project.platform].join(" "));
    const groups = DOMAIN_GROUPS.filter((group) => group.terms.some((term) => includesTerm(queryText, term)));
    return {
      queryText,
      weightedTerms: [...merged].map(([term, weight]) => ({ term, weight })).slice(0, 45),
      objectiveTerms: [
        ...termSet(project.title, 1.8),
        ...termSet(project.objective, 1.1),
        ...termSet(project.content, 1)
      ],
      platformTerms: termSet(project.platform, 1),
      deliverableTerms: DELIVERABLE_TERMS.filter((term) => includesTerm(queryText, term)).map((term) => ({ term, weight: 1 })),
      groups
    };
  }

  function scoreRecord(record, project, signals) {
    const title = normalize(`${record.titleKo} ${record.titleEn}`);
    const keywords = normalize(`${(record.keywordsKo || []).join(" ")} ${(record.keywordsEn || []).join(" ")}`);
    const summary = normalize(record.summary);
    const org = normalize(`${record.leadOrg} ${record.orderingOrg} ${record.managementOrg}`);
    const combined = `${title} ${keywords} ${summary}`;

    const maxLexical = signals.weightedTerms.reduce((sum, item) => sum + item.weight * 6, 0) || 1;
    let lexicalRaw = 0;
    for (const item of signals.weightedTerms) {
      const fieldWeight = includesTerm(title, item.term) ? 6
        : includesTerm(keywords, item.term) ? 4.5
          : includesTerm(summary, item.term) ? 2.5
            : includesTerm(org, item.term) ? 0.75 : 0;
      lexicalRaw += item.weight * fieldWeight;
    }
    const lexical = Math.min(1, lexicalRaw / maxLexical);

    const objectiveContent = Math.min(1, weightedCoverage(signals.objectiveTerms, combined) * 1.45 + lexical * 0.35);
    const deliverableRequirement = signals.deliverableTerms.length
      ? weightedCoverage(signals.deliverableTerms, combined)
      : Math.min(0.5, lexical);
    const matchedGroups = signals.groups.filter((group) => group.terms.some((term) => includesTerm(combined, term)));
    const groupWeight = signals.groups.reduce((sum, group) => sum + group.weight, 0);
    const matchedGroupWeight = matchedGroups.reduce((sum, group) => sum + group.weight, 0);
    const technologyTerm = groupWeight ? matchedGroupWeight / groupWeight : lexical;
    const classification = project.stage
      ? (includesTerm(normalize(record.stage), project.stage) ? 1 : record.stage ? 0.2 : 0)
      : 0.35;
    const unmannedGroup = DOMAIN_GROUPS.find((group) => group.key === "unmanned");
    const queryHasUnmanned = signals.groups.some((group) => group.key === "unmanned");
    const recordHasUnmanned = unmannedGroup.terms.some((term) => includesTerm(combined, term));
    const weaponSystemItem = queryHasUnmanned && recordHasUnmanned
      ? 1
      : signals.platformTerms.length ? weightedCoverage(signals.platformTerms, combined) : Math.min(0.55, technologyTerm);
    const startYear = Number(String(record.startDate).slice(0, 4)) || 0;
    const organizationTimeStage = Math.min(1,
      (record.leadOrg ? 0.35 : 0) +
      (record.orderingOrg ? 0.15 : 0) +
      (startYear >= 2020 ? 0.4 : startYear >= 2015 ? 0.25 : 0.1)
    );

    const factorValues = {
      objectiveContent,
      deliverableRequirement,
      technologyTerm,
      classification,
      weaponSystemItem,
      organizationTimeStage
    };
    const score = Math.round(Math.min(1, (
      objectiveContent * 0.35 +
      deliverableRequirement * 0.15 +
      technologyTerm * 0.30 +
      classification * 0.05 +
      weaponSystemItem * 0.08 +
      organizationTimeStage * 0.07
    ) + lexical * 0.15) * 100);

    const evidenceDetails = [];
    if (record.titleKo) evidenceDetails.push({ field: "연구개발사업한글명", label: "과제명", excerpt: record.titleKo });
    if ((record.keywordsKo || []).length) evidenceDetails.push({ field: "연구개발사업한글키워드값", label: "키워드", excerpt: record.keywordsKo.join(", ") });
    if (record.summary) evidenceDetails.push({ field: "연구개발사업개요내용", label: "과제개요", excerpt: record.summary });

    const queryHasEdge = DOMAIN_GROUPS.find((group) => group.key === "edge").terms.some((term) => includesTerm(signals.queryText, term));
    const recordHasEdge = DOMAIN_GROUPS.find((group) => group.key === "edge").terms.some((term) => includesTerm(combined, term));
    let difference = "공개 과제개요만으로 요구성능·운용조건 차이는 확인되지 않음";
    if (queryHasEdge && !recordHasEdge) difference = "공개 필드에서 탑재형·엣지처리 범위가 명시되지 않아 추가 확인 필요";
    else if (technologyTerm >= 0.65) difference = "기술영역 중첩이 커서 요구성능·적용체계·운용조건의 차이를 우선 확인할 필요";

    const missingFields = [];
    if (!record.summary) missingFields.push("과제개요");
    if (!record.stage) missingFields.push("과제단계");
    if (!signals.platformTerms.length || weaponSystemItem === 0) missingFields.push("대상체계");

    return {
      id: record.id,
      source: "defense",
      sourceLabel: "국방",
      score,
      level: score >= 60 ? "high" : score >= 35 ? "medium" : "low",
      title: record.titleKo,
      titleEn: record.titleEn,
      org: record.leadOrg || record.managementOrg || "기관 미집계",
      period: [record.startDate, record.endDate].filter(Boolean).join(" – ") || "기간 미집계",
      evidence: evidenceDetails.slice(0, 3).map((item) => `${item.label}: ${item.excerpt}`),
      evidenceDetails: evidenceDetails.slice(0, 3),
      difference,
      factors: [objectiveContent, deliverableRequirement, technologyTerm, classification, weaponSystemItem, organizationTimeStage].map((value) => Math.round(value * 100)),
      field: evidenceDetails[2]?.field || evidenceDetails[0]?.field || "연구개발사업관리번호",
      excerpt: evidenceDetails[2]?.excerpt || evidenceDetails[0]?.excerpt || record.id,
      path: `Project[${record.id}] → PERFORMED_BY → ${record.leadOrg || "미집계"}`,
      hash: `sha256:${record.recordSha256.slice(0, 12)}…`,
      fullHash: record.recordSha256,
      sourceRow: record.sourceRow,
      stage: record.stage,
      programType: record.programType,
      orderingOrg: record.orderingOrg,
      managementOrg: record.managementOrg,
      sourceUrl: "https://www.data.go.kr/data/15041871/fileData.do",
      matchedConcepts: matchedGroups.map((group) => group.label),
      missingFields,
      lexical
    };
  }

  function searchRecords(index, project, limit = 10) {
    if (!index?.records?.length) return { candidates: [], diagnostics: { recordCount: 0, queryTerms: [] } };
    const signals = buildSignals(project);
    const scored = index.records
      .map((record) => scoreRecord(record, project, signals))
      .filter((candidate) => candidate.lexical >= 0.025 || candidate.score >= 30)
      .sort((left, right) => right.score - left.score || right.lexical - left.lexical || left.id.localeCompare(right.id, "ko"));
    return {
      candidates: scored.slice(0, limit),
      diagnostics: {
        recordCount: index.records.length,
        matchedCount: scored.length,
        queryTerms: signals.weightedTerms.map((item) => item.term),
        concepts: signals.groups.map((group) => group.label)
      }
    };
  }

  const api = { normalize, tokenize, buildSignals, searchRecords };
  globalScope.AcqSearch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
